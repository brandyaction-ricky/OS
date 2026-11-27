import { createElement } from "react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { ZodError } from "zod";
import { myinPreviewSchema } from "@/lib/cardnews/myin-preview";
import { CardSlideView } from "@/lib/cardnews/card-slide";
import { storedZip } from "@/lib/cardnews/zip";
import { youtubeActor } from "@/lib/server/youtube-process";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const local = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEMO_MODE === "true" && ["127.0.0.1", "localhost"].includes(new URL(request.url).hostname);
    if (!local) await youtubeActor(request);
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) throw new ApiError(403, "ORIGIN_INVALID", "이 화면에서 다시 시도해 주세요.");
    const input = myinPreviewSchema.parse(await parseJson(request, 2_100_000));
    const fonts = await Promise.all(([400,500,600] as const).map(async weight => ({ name: "Pretendard", weight, style: "normal" as const, data: await readFile(join(process.cwd(), "lib/cardnews/fonts", `Pretendard-${weight}.woff`)) })));
    const photos: Record<string,string> = {};
    for (const name of ["character.png", "report-sample.jpg", "work-observation.png"]) photos["/myin-cards/" + name] = `data:image/${name.endsWith("jpg") ? "jpeg" : "png"};base64,${(await readFile(join(process.cwd(), "public/myin-cards", name))).toString("base64")}`;
    if (input.art) {
      const buffer = Buffer.from(input.art.split(",")[1], "base64");
      if (buffer.length < 24 || buffer.subarray(0,8).toString("hex") !== "89504e470d0a1a0a" || buffer.readUInt32BE(16) < 1 || buffer.readUInt32BE(20) < 1 || buffer.readUInt32BE(16) > 2400 || buffer.readUInt32BE(20) > 2400) throw new ApiError(400, "MYIN_ART_INVALID", "2400px 이하 PNG 그림을 넣어 주세요.");
      photos["/myin-cards/work-observation.png"] = input.art;
    }
    const render = async (index: number) => new Uint8Array(await new ImageResponse(createElement(CardSlideView, { draft: input.draft, index, photos }), { width: 1080, height: 1350, fonts }).arrayBuffer());
    const headers = { "cache-control": "private, no-store" };
    if (!input.zip) return new Response(await render(input.slide ?? 0), { headers: { ...headers, "content-type": "image/png" } });
    const files = [];
    for (let index=0; index<input.draft.slides.length; index++) files.push({ name: `card-${String(index+1).padStart(2,"0")}.png`, data: await render(index) });
    files.push({ name: "caption.txt", data: new TextEncoder().encode(input.draft.caption + "\n\n" + input.draft.hashtags.map(s => "#"+s).join(" ")) });
    return new Response(new Uint8Array(storedZip(files)), { headers: { ...headers, "content-type": "application/zip", "content-disposition": 'attachment; filename="myin-cardnews.zip"' } });
  } catch (error) {
    return apiErrorResponse(error instanceof ZodError ? new ApiError(400, "MYIN_PROOF_INVALID", error.issues[0]?.message || "원고를 확인해 주세요.") : error);
  }
}
