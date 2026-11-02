// 카드 그림 (대표 2026-11-02): GPT Image draws a card picture into the project's files (the same place an uploaded photo goes), and the
// 캐릭터 창고 keeps the pictures it should draw the same characters from. Each picture has its own small JSON beside it, written once
// and never overwritten: a shared list file lost saves made seconds apart (2026-11-02, 4 saves → 3 kept). No table.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { DEFAULT_COST_MODELS } from "@/lib/cost";
import { CARD_CHARACTERS_MAX, CARD_DRAW_REFS_MAX, CARD_DRAW_SCENE_MAX, CARD_DRAW_SIZE, cardDrawPrompt, type CardCharacter, type CardCharacterView } from "@/lib/cardnews/draw";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { getYoutubeProject } from "./youtube-process";
import { MEDIA_BUCKET } from "./youtube-process-stages";

const CHARACTERS = "card-characters";
const RECORD = /^[0-9a-f-]{36}\.json$/;
export const imageModel = () => process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_COST_MODELS.image;

export const cardDrawSchema = z.object({
  action: z.literal("draw"), scene: z.string().trim().min(2).max(CARD_DRAW_SCENE_MAX), style: z.enum(["webtoon", "simple"]),
  quality: z.enum(["medium", "high"]), refs: z.array(z.string().uuid()).max(CARD_DRAW_REFS_MAX).default([]),
}).strict();
export const characterAddSchema = z.object({ projectId: z.string().uuid(), path: z.string().max(200), name: z.string().trim().min(1).max(40) }).strict();

const characterSchema = z.object({ id: z.string().uuid(), name: z.string(), path: z.string(), at: z.string(), byId: z.string(), by: z.string() });
// The folder listing is a database read (never a cached copy); each record is read once it exists and is never rewritten.
async function readCharacters(): Promise<CardCharacter[]> {
  const bucket = createServiceSupabase().storage.from(MEDIA_BUCKET);
  const { data, error } = await bucket.list(CHARACTERS, { limit: 1000 });
  if (error) throw new ApiError(503, "CARD_CHARACTERS_READ_FAILED", "캐릭터 창고를 불러오지 못했어요. 다시 시도해 주세요.");
  const rows = await Promise.all((data ?? []).filter(file => RECORD.test(file.name)).map(async file => {
    const { data: blob } = await bucket.download(`${CHARACTERS}/${file.name}`);
    const parsed = blob ? characterSchema.safeParse(await blob.text().then(JSON.parse, () => null)) : null;
    return parsed?.success ? parsed.data : null;   // a record cut short by a failed save is skipped, not fatal
  }));
  return rows.filter((row): row is CardCharacter => Boolean(row)).sort((a, b) => a.at.localeCompare(b.at));
}
async function withUrls(list: CardCharacter[]): Promise<CardCharacterView[]> {
  if (!list.length) return [];
  const { data, error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).createSignedUrls(list.map(row => row.path), 3600);
  if (error || !data) throw new ApiError(502, "CARD_CHARACTERS_URL_FAILED", "캐릭터 그림 주소를 만들지 못했어요.");
  return list.map((row, index) => ({ ...row, url: data[index]?.signedUrl ?? "" }));
}

/** Everyone who makes cards sees the 창고 (the route has already checked the session). */
export const listCardCharacters = async () => withUrls(await readCharacters());

/** 캐릭터로 저장: a picture already on one of the project's cards is copied into the 창고 under a name. */
export async function addCardCharacter(actor: RequestActor, input: z.infer<typeof characterAddSchema>) {
  const project = await getYoutubeProject(actor, input.projectId);
  const match = new RegExp(`^youtube/${project.id}/card/[0-9a-f-]{36}\\.(jpg|png)$`).exec(input.path);
  if (!match) throw new ApiError(400, "ASSET_PATH_INVALID", "카드에 들어간 그림만 캐릭터로 저장할 수 있어요.");
  const list = await readCharacters();
  if (list.length >= CARD_CHARACTERS_MAX) throw new ApiError(409, "CARD_CHARACTERS_FULL", `캐릭터 그림은 ${CARD_CHARACTERS_MAX}장까지예요. 안 쓰는 그림을 먼저 빼 주세요.`);
  const id = randomUUID(), path = `${CHARACTERS}/${id}.${match[1]}`;
  const { error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).copy(input.path, path);
  if (error) throw new ApiError(502, "CARD_CHARACTER_COPY_FAILED", "그림을 캐릭터 창고로 옮기지 못했어요.");
  const row: CardCharacter = { id, name: input.name, path, at: new Date().toISOString(), byId: actor.ownerId, by: actor.name };
  const saved = await createServiceSupabase().storage.from(MEDIA_BUCKET)
    .upload(`${CHARACTERS}/${id}.json`, new Blob([JSON.stringify(row)], { type: "application/json" }), { upsert: false, contentType: "application/json" });
  if (saved.error) throw new ApiError(502, "CARD_CHARACTERS_SAVE_FAILED", "캐릭터 창고에 저장하지 못했어요.");
  return withUrls([...list, row]);
}

/** 빼기: the one who saved it, or an admin. */
export async function removeCardCharacter(actor: RequestActor, id: string) {
  const list = await readCharacters();
  const row = list.find(item => item.id === id);
  if (!row) throw new ApiError(404, "CARD_CHARACTER_NOT_FOUND", "그 캐릭터 그림이 없어요.");
  if (row.byId !== actor.ownerId && actor.role !== "admin") throw new ApiError(403, "CARD_CHARACTER_FORBIDDEN", "저장한 사람이나 관리자만 뺄 수 있어요.");
  const { error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).remove([`${CHARACTERS}/${id}.json`, row.path]);
  if (error) throw new ApiError(502, "CARD_CHARACTER_REMOVE_FAILED", "캐릭터 그림을 빼지 못했어요. 다시 시도해 주세요.");
  return withUrls(list.filter(item => item.id !== id));
}

/** Why GPT Image said no, in words the PD can act on. Its own message is not shown: it can be long and in English. */
function drawError(status: number, body: { error?: { code?: unknown; message?: unknown } }) {
  const code = String(body.error?.code ?? ""), message = String(body.error?.message ?? "");
  console.error(`card draw ${status} ${code.replace(/[^\w.-]/g, "").slice(0, 60)}`);
  if (code === "moderation_blocked") return new ApiError(422, "CARD_DRAW_BLOCKED", "그림 요청이 OpenAI 정책에 걸렸어요. 장면 설명을 바꿔 다시 그려 주세요.");
  if (status === 403 && /verif/i.test(message)) return new ApiError(403, "OPENAI_ORG_NOT_VERIFIED", "OpenAI 조직 인증이 필요해요. OpenAI 사이트 설정에서 조직 인증을 마친 뒤 다시 그려 주세요.");
  return new ApiError(502, "CARD_DRAW_FAILED", "그림을 그리지 못했어요. 잠시 뒤 다시 그려 주세요.");
}

/** 그리기: one picture for 카드 만들기, saved where an uploaded photo goes; the PD puts it on the card the way a photo is put. */
export async function drawCardImage(actor: RequestActor, projectId: string, input: z.infer<typeof cardDrawSchema>) {
  const project = await getYoutubeProject(actor, projectId);
  if (project.yp.topic.type !== "card") throw new ApiError(404, "CARD_NOT_FOUND", "카드뉴스가 아니에요.");
  if (project.yp.stage !== "draft") throw new ApiError(409, "CARD_DRAW_CLOSED", "카드 만들기 단계에서 그릴 수 있어요.");
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI 연결이 아직 없어서 그림을 그릴 수 없어요.");
  const list = input.refs.length ? await readCharacters() : [];
  const refs = input.refs.map(id => list.find(row => row.id === id));
  if (refs.some(row => !row)) throw new ApiError(400, "CARD_CHARACTER_NOT_FOUND", "고른 캐릭터 그림이 창고에 없어요. 다시 골라 주세요.");
  const service = createServiceSupabase();
  const files = await Promise.all(refs.map(async (row, index) => {
    const { data, error } = await service.storage.from(MEDIA_BUCKET).download(row!.path);
    if (error || !data) throw new ApiError(502, "CARD_CHARACTER_READ_FAILED", `캐릭터 그림 「${row!.name}」을 읽지 못했어요.`);
    return new File([data], `ref-${index + 1}.${row!.path.endsWith(".png") ? "png" : "jpg"}`, { type: row!.path.endsWith(".png") ? "image/png" : "image/jpeg" });
  }));
  const prompt = cardDrawPrompt(input.scene, input.style, refs.map(row => row!.name));
  const common = { model: imageModel(), prompt, size: `${CARD_DRAW_SIZE.width}x${CARD_DRAW_SIZE.height}`, quality: input.quality, n: 1, output_format: "png" };
  let body: BodyInit;
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (files.length) {   // the edits endpoint is the one that takes reference pictures (image[])
    const form = new FormData();
    for (const [name, value] of Object.entries(common)) form.append(name, String(value));
    for (const file of files) form.append("image[]", file);
    body = form;
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify(common);
  }
  const response = await fetch(`https://api.openai.com/v1/images/${files.length ? "edits" : "generations"}`, { method: "POST", headers, body, cache: "no-store", signal: AbortSignal.timeout(240_000) })
    .catch(() => { throw new ApiError(504, "CARD_DRAW_TIMEOUT", "그림이 너무 오래 걸려 멈췄어요. 다시 그려 주세요."); });
  const result = await response.json().catch(() => ({})) as { data?: { b64_json?: string }[]; error?: { code?: unknown; message?: unknown } };
  if (!response.ok) throw drawError(response.status, result);
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new ApiError(502, "CARD_DRAW_EMPTY", "그림이 비어 있어요. 다시 그려 주세요.");
  const path = `youtube/${project.id}/card/${randomUUID()}.png`;
  const { error } = await service.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(b64, "base64"), { contentType: "image/png", upsert: false });
  if (error) throw new ApiError(502, "CARD_DRAW_SAVE_FAILED", "그린 그림을 저장하지 못했어요. 다시 그려 주세요.");
  return { path, w: CARD_DRAW_SIZE.width, h: CARD_DRAW_SIZE.height };
}
