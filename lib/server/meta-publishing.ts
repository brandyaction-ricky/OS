import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http";
import { PublicationError, type PublicationSettings, type PublishProvider } from "@/lib/channel-publishing";
import { assertMetaModeMatches, metaAccessToken, metaMode, type MetaConnection } from "./meta-oauth";

export function metaPublishProvider(connection: MetaConnection, settings: PublicationSettings, publicationId: string, signedUrls: string[]): PublishProvider {
  assertMetaModeMatches(connection);
  if (metaMode() === "mock") return {
    create: async index => `mock-${index}-${randomUUID()}`,
    inspect: async () => "ready",
    publish: async containerId => ({ id: `mock-${createHash("sha256").update(`${publicationId}:${containerId}`).digest("hex").slice(0,24)}`, permalink: "" }),
  };
  const token = metaAccessToken(connection), instagram = connection.platform === "instagram";
  // Pin the Instagram Graph version explicitly in an approved live environment.
  const version = process.env.META_INSTAGRAM_GRAPH_VERSION;
  if (instagram && !/^v\d+\.\d+$/.test(version ?? "")) throw new ApiError(503, "META_VERSION_REQUIRED", "실계정 검수에서 확인한 Instagram Graph 버전을 설정해 주세요.");
  const host = instagram ? `https://graph.instagram.com/${version}` : "https://graph.threads.net";
  const account = encodeURIComponent(connection.external_account_id);
  const request = async (path: string, fields: Record<string,string>, method: "GET" | "POST" = "POST") => {
    let response: Response;
    try { response = await fetch(`${host}/${path}${method === "GET" ? `?${new URLSearchParams(fields)}` : ""}`, {
      method, headers: { authorization: `Bearer ${token}` }, ...(method === "POST" ? { body: new URLSearchParams(fields) } : {}), cache: "no-store", signal: AbortSignal.timeout(20_000),
    }); } catch { throw new PublicationError("META_REQUEST_UNCERTAIN", "플랫폼 응답을 받지 못했습니다. 게시 결과를 먼저 확인해 주세요."); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw new PublicationError(response.status >= 500 ? "META_REQUEST_UNCERTAIN" : "META_PUBLISH_REJECTED", "플랫폼에서 요청을 확인하지 못했습니다. 연결 권한·파일·한도를 확인해 주세요.");
    return body as Record<string,unknown>;
  };
  const idOf = (body: Record<string,unknown>) => { if (typeof body.id !== "string" || !body.id) throw new PublicationError("META_ID_MISSING", "플랫폼 작업 ID를 확인하지 못했습니다."); return body.id; };
  const endpoint = `${account}/${instagram ? "media" : "threads"}`;
  const copy = [settings.caption, settings.hashtags].filter(Boolean).join("\n\n");
  return {
    async create(index, replyToId) {
      if (settings.platformFormat.endsWith("carousel")) {
        const children: string[] = [];
        for (const url of signedUrls) children.push(idOf(await request(endpoint, { image_url: url, is_carousel_item: "true", ...(!instagram ? { media_type: "IMAGE" } : {}) })));
        return idOf(await request(endpoint, { media_type: "CAROUSEL", children: children.join(","), [instagram ? "caption" : "text"]: copy, ...(!instagram ? { reply_control: settings.replyControl } : {}) }));
      }
      if (instagram) return idOf(await request(endpoint, { media_type: "REELS", video_url: signedUrls[0], caption: copy }));
      return idOf(await request(endpoint, { media_type: "TEXT", text: settings.platformFormat === "threads_chain" ? settings.parts[index] : copy, reply_control: settings.replyControl, ...(replyToId ? { reply_to_id: replyToId } : {}) }));
    },
    async inspect(containerId) {
      const body = await request(encodeURIComponent(containerId), { fields: instagram ? "status_code" : "status" }, "GET");
      const status = body.status_code ?? body.status;
      if (status === "FINISHED") return "ready";
      if (status === "EXPIRED") return "expired";
      if (status === "PUBLISHED") return "published";
      if (status === "IN_PROGRESS") return "processing";
      throw new PublicationError("META_CONTAINER_FAILED", "플랫폼에서 파일 준비에 실패했습니다. 파일을 확인해 주세요.");
    },
    async publish(containerId) {
      const id = idOf(await request(`${account}/${instagram ? "media_publish" : "threads_publish"}`, { creation_id: containerId }));
      // A permalink lookup failure must never lose an acknowledged publication ID.
      let permalink = "";
      try { const body=await request(encodeURIComponent(id),{fields:"permalink"},"GET"); if(typeof body.permalink==="string"&&body.permalink.startsWith("https://"))permalink=body.permalink; } catch { /* ID remains the durable receipt. */ }
      return { id, permalink };
    },
  };
}
