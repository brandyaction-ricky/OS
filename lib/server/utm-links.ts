import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { UTM_BRANDS, UTM_KINDS, buildUtmUrl, normalizeUtmCode, parseOriginUrl, utmConflicts, validUtmCode, type UtmKind } from "@/lib/utm";
import { UTM_LEDGER, utmLedgerMarkdown, type UtmLedgerRow } from "@/lib/utm-ledger";
import { makeMyinShortLink } from "./myin-short-links";
import { authenticateRequest } from "./auth";

// Staff (not partners, not AI keys) use 링크관리; admins also rename or turn off shared choices (기능요청서 2026-10-28 §5).
export async function utmActor(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.type !== "user") throw new ApiError(403, "USER_SESSION_REQUIRED", "직원 로그인으로 열어 주세요.");
  const { data, error } = await createServiceSupabase().from("os_profiles").select("display_name,member_kind,is_active,role").eq("id", actor.id).single();
  if (error || !data?.is_active || data.member_kind === "partner") throw new ApiError(403, "UTM_FORBIDDEN", "링크관리는 사내 직원만 쓸 수 있어요.");
  return { id: actor.id, name: String(data.display_name ?? "구성원"), isAdmin: data.role === "admin" };
}
type UtmActor = Awaited<ReturnType<typeof utmActor>>;

export type UtmOption = { id: string; kind: UtmKind; label: string; code: string; active: boolean; created_at: string };
const OPTION_COLUMNS = "id,kind,label,code,active,created_at";
const unique = (error: { code?: string } | null) => error?.code === "23505";

export async function listUtmOptions() {
  const { data, error } = await createServiceSupabase().from("os_utm_options").select(OPTION_COLUMNS).order("kind").order("label");
  if (error) throw new ApiError(503, "UTM_OPTIONS_UNAVAILABLE", "선택값을 불러오지 못했어요.");
  return data as UtmOption[];
}

export const utmOptionSchema = z.object({ kind: z.enum(UTM_KINDS), label: z.string().trim().min(1).max(80), code: z.string().max(100) }).strict();
export async function createUtmOption(input: z.infer<typeof utmOptionSchema>, actor: UtmActor) {
  const code = normalizeUtmCode(input.code);
  if (!validUtmCode(code)) throw new ApiError(400, "UTM_CODE_INVALID", "URL 코드는 영문 소문자·숫자·밑줄(_)·하이픈(-)만 쓸 수 있어요.");
  const db = createServiceSupabase();
  const { data, error } = await db.from("os_utm_options").insert({ kind: input.kind, label: input.label, code, created_by: actor.id }).select(OPTION_COLUMNS).single();
  if (!error) return data as UtmOption;
  if (!unique(error)) throw new ApiError(503, "UTM_OPTION_SAVE_FAILED", "선택값을 저장하지 못했어요.");
  // Same code or same name in this kind (case, spaces, turned-off ones and a simultaneous add included): point at it.
  const { data: rows } = await db.from("os_utm_options").select(OPTION_COLUMNS).eq("kind", input.kind);
  const existing = (rows as UtmOption[] | null)?.find(row => row.code === code || row.label.trim().toLowerCase() === input.label.trim().toLowerCase());
  throw new ApiError(409, "UTM_OPTION_EXISTS", existing
    ? `이미 있어요: ${existing.label} (${existing.code})${existing.active ? " — 그 값을 고르세요." : " — 꺼져 있는 값이에요. 관리자에게 다시 켜 달라고 해 주세요."}`
    : "같은 이름이나 코드가 이미 있어요.", existing ? { option: existing } : undefined);
}

export const utmOptionUpdateSchema = z.object({ label: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() }).strict();
export async function updateUtmOption(id: string, input: z.infer<typeof utmOptionUpdateSchema>, actor: UtmActor) {
  if (!actor.isAdmin) throw new ApiError(403, "ADMIN_REQUIRED", "선택값 이름 바꾸기·끄기는 관리자만 할 수 있어요.");
  // The code is not editable at all, so a link made earlier keeps its meaning; links store the name they were made with.
  const { data, error } = await createServiceSupabase().from("os_utm_options").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select(OPTION_COLUMNS).maybeSingle();
  if (unique(error)) throw new ApiError(409, "UTM_OPTION_EXISTS", "같은 이름이 이미 있어요.");
  if (error) throw new ApiError(503, "UTM_OPTION_SAVE_FAILED", "선택값을 저장하지 못했어요.");
  if (!data) throw new ApiError(404, "UTM_OPTION_NOT_FOUND", "선택값을 찾지 못했어요.");
  return data as UtmOption;
}

const LINK_COLUMNS = "id,request_id,brand,usage,origin_url,source_id,medium_id,campaign_id,content_id,params,target,location,etc,utm_url,short_key,short_url,ledger_status,created_by,created_at";
export type UtmLink = { id: string; request_id: string; brand: string; usage: string; origin_url: string; source_id: string; medium_id: string; campaign_id: string; content_id: string | null; params: UtmLedgerRow["params"]; target: string; location: string; etc: string;
  utm_url: string; short_key: string | null; short_url: string | null; ledger_status: "pending" | "saved" | "failed"; created_by: string; created_at: string; creator?: string };

async function withCreators(rows: UtmLink[]) {
  const ids = [...new Set(rows.map(row => row.created_by))];
  const { data } = ids.length ? await createServiceSupabase().from("os_profiles").select("id,display_name").in("id", ids) : { data: [] };
  const names = new Map((data ?? []).map(row => [row.id as string, String(row.display_name ?? "")]));
  return rows.map(row => ({ ...row, creator: names.get(row.created_by) || "구성원" }));
}

export async function listUtmLinks(limit = 500) {
  const { data, error } = await createServiceSupabase().from("os_utm_links").select(LINK_COLUMNS).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new ApiError(503, "UTM_LINKS_UNAVAILABLE", "링크 대장을 불러오지 못했어요.");
  return withCreators(data as UtmLink[]);
}

const memo = (max: number) => z.string().trim().max(max).default("");
export const utmLinkSchema = z.object({
  requestId: z.string().uuid(), brand: z.enum(UTM_BRANDS.map(row => row.brand) as [string, ...string[]]),
  usage: z.string().trim().min(1).max(200), originUrl: z.string().max(2000),
  sourceId: z.string().uuid(), mediumId: z.string().uuid(), campaignId: z.string().uuid(), contentId: z.string().uuid().nullable().default(null),
  target: memo(200), location: memo(200), etc: memo(500), confirmOverwrite: z.boolean().default(false),
}).strict();

export async function createUtmLink(input: z.infer<typeof utmLinkSchema>, actor: UtmActor) {
  const db = createServiceSupabase();
  const { data: again } = await db.from("os_utm_links").select(LINK_COLUMNS).eq("request_id", input.requestId).maybeSingle();
  if (again) return { link: again as UtmLink, repeated: true };
  const parsed = parseOriginUrl(input.originUrl);
  if ("error" in parsed) throw new ApiError(400, "UTM_ORIGIN_INVALID", parsed.error);
  const wanted: Record<UtmKind, string | null> = { source: input.sourceId, medium: input.mediumId, campaign: input.campaignId, content: input.contentId };
  const ids = Object.values(wanted).filter((id): id is string => Boolean(id));
  const { data: options, error } = await db.from("os_utm_options").select(OPTION_COLUMNS).in("id", ids);
  if (error) throw new ApiError(503, "UTM_OPTIONS_UNAVAILABLE", "선택값을 불러오지 못했어요.");
  const params = {} as UtmLedgerRow["params"];
  for (const kind of UTM_KINDS) {
    const id = wanted[kind], option = (options as UtmOption[]).find(row => row.id === id);
    if (!id) { params[kind] = null; continue; }
    if (!option || option.kind !== kind) throw new ApiError(400, "UTM_OPTION_INVALID", "선택값을 다시 골라 주세요.");
    if (!option.active) throw new ApiError(400, "UTM_OPTION_INACTIVE", `꺼진 선택값이에요: ${option.label}. 다른 값을 고르세요.`);
    params[kind] = { code: option.code, label: option.label };
  }
  const codes = { source: params.source!.code, medium: params.medium!.code, campaign: params.campaign!.code, content: params.content?.code ?? null };
  const conflicts = utmConflicts(parsed.url, codes);
  if (conflicts.length && !input.confirmOverwrite) throw new ApiError(409, "UTM_OVERWRITE_CONFIRM", "원본 주소에 이미 UTM 값이 있어요. 바뀌는 값을 확인해 주세요.", { conflicts });
  const { data: link, error: insertError } = await db.from("os_utm_links").insert({
    request_id: input.requestId, brand: input.brand, usage: input.usage, origin_url: parsed.url.href,
    source_id: input.sourceId, medium_id: input.mediumId, campaign_id: input.campaignId, content_id: input.contentId, params,
    target: input.target, location: input.location, etc: input.etc, utm_url: buildUtmUrl(parsed.url, codes), created_by: actor.id,
  }).select(LINK_COLUMNS).single();
  if (unique(insertError)) {
    const { data: same } = await db.from("os_utm_links").select(LINK_COLUMNS).eq("request_id", input.requestId).single();
    return { link: same as UtmLink, repeated: true };
  }
  if (insertError) throw new ApiError(503, "UTM_LINK_SAVE_FAILED", "링크를 저장하지 못했어요.");
  return { link: link as UtmLink, repeated: false };
}

/** Rebuilds the company 링크 대장 document from every row; true when the document holds them all. */
export async function syncUtmLedger(ownerFallback: string) {
  const db = createServiceSupabase(), startedAt = new Date().toISOString();
  try {
    const rows = await listUtmLinks(5000), content = utmLedgerMarkdown(rows.map(row => ({ ...row, creator: row.creator ?? "" })));
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: current, error } = await db.from("os_documents").select("id,current_version").eq("source", UTM_LEDGER.source).eq("source_ref", UTM_LEDGER.sourceRef).neq("status", "archived").maybeSingle();
      if (error) throw error;
      if (!current) {
        const { data: admin } = await db.from("os_profiles").select("id").eq("is_active", true).eq("role", "admin").order("id").limit(1).maybeSingle();
        const owner = (admin?.id as string | undefined) ?? ownerFallback;
        const { error: insertError } = await db.from("os_documents").insert({ title: UTM_LEDGER.title, content_md: content, folder: UTM_LEDGER.folder, status: "team",
          source: UTM_LEDGER.source, source_ref: UTM_LEDGER.sourceRef, owner_id: owner, created_by: owner, brand: "브랜디액션", team: "", tags: ["링크관리", "UTM"] });
        if (!insertError) break;
        continue;
      }
      const { data: saved } = await db.from("os_documents").update({ content_md: content }).eq("id", current.id).eq("current_version", current.current_version).select("id").maybeSingle();
      if (saved) break;
      if (attempt === 1) throw new Error("ledger version race");
    }
    await db.from("os_utm_links").update({ ledger_status: "saved", updated_at: new Date().toISOString() }).neq("ledger_status", "saved").lte("created_at", startedAt);
    return true;
  } catch {
    await db.from("os_utm_links").update({ ledger_status: "failed", updated_at: new Date().toISOString() }).eq("ledger_status", "pending");
    return false;
  }
}

export async function readUtmLink(id: string) {
  const { data, error } = await createServiceSupabase().from("os_utm_links").select(LINK_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new ApiError(503, "UTM_LINKS_UNAVAILABLE", "링크를 불러오지 못했어요.");
  if (!data) throw new ApiError(404, "UTM_LINK_NOT_FOUND", "링크를 찾지 못했어요.");
  return (await withCreators([data as UtmLink]))[0];
}

/** Shortens the saved UTM address with the existing MYIN short link; the UTM row itself stays as it was. */
export async function shortenUtmLink(id: string, actor: UtmActor) {
  const link = await readUtmLink(id);
  if (link.short_url) return link;
  const short = await makeMyinShortLink({ url: link.utm_url, label: link.usage.slice(0, 80) }, actor.id);
  const { error } = await createServiceSupabase().from("os_utm_links").update({ short_key: short.key, short_url: short.url, updated_at: new Date().toISOString() }).eq("id", id).is("short_url", null);
  if (error) throw new ApiError(503, "UTM_SHORT_SAVE_FAILED", "단축링크는 만들었지만 대장에 연결하지 못했어요. 다시 눌러 주세요.");
  return readUtmLink(id);
}
