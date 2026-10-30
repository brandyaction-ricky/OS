import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { mergeReported, VOICE_DICTIONARY_MAX, type VoiceDictionary, type VoiceDictionaryFiles } from "@/lib/youtube-process/voice-dictionary";
import type { RequestActor } from "./auth";
import { ypUuid } from "./youtube-process-stages";

// 음성 사전 (로건 OS 요청 2026-10-30, phase ④): one company record, like the 숏폼 공식 창고.
type Service = ReturnType<typeof createServiceSupabase>;
const dictionaryId = () => ypUuid("yp-voice-dictionary");
const empty = (): VoiceDictionary => ({ readings: [], tests: [] });

export async function readVoiceDictionary(service: Service = createServiceSupabase()) {
  const { data, error } = await service.from("os_records").select("version,metadata").eq("id", dictionaryId()).maybeSingle();
  if (error) throw new ApiError(503, "VOICE_DICTIONARY_READ_FAILED", "음성 사전을 읽지 못했어요.");
  const dictionary = (data?.metadata?.dictionary ?? null) as VoiceDictionary | null;
  return { dictionary: dictionary ?? empty(), version: (data?.version as number | undefined) ?? 0, exists: Boolean(data) };
}

async function write(service: Service, dictionary: VoiceDictionary, expectedVersion: number, by: { id: string; team: string }) {
  const metadata = { packageKind: "yp_voice_dictionary", dictionary };
  const { data, error } = expectedVersion
    ? await service.from("os_records").update({ metadata, updated_by: by.id }).eq("id", dictionaryId()).eq("version", expectedVersion).select("version").maybeSingle()
    : await service.from("os_records").insert({ id: dictionaryId(), record_type: "content_package", title: "음성 사전", description: "", status: "active", priority: "normal",
      brand: "브랜디액션", team: by.team || "콘텐츠", owner_id: by.id, created_by: by.id, updated_by: by.id, tags: ["유튜브", "음성", "사전"], metadata }).select("version").maybeSingle();
  if (error?.code === "23505" || (!error && !data)) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  if (error) throw new ApiError(500, "VOICE_DICTIONARY_SAVE_FAILED", "음성 사전을 저장하지 못했어요.");
  return data!.version as number;
}

/** A render PC's files after a voice job: lines the OS does not have yet come in (auto, or as his starting set the first time). */
export async function reportVoiceDictionary(reported: Partial<VoiceDictionaryFiles> | undefined, owner: { id: string; team: string }, service: Service = createServiceSupabase()) {
  if (!reported) return 0;
  // ponytail: one retry on a version clash covers a person saving at the same moment; a lost report comes back with the next job.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { dictionary, version } = await readVoiceDictionary(service);
    const { next, added } = mergeReported(dictionary, reported, new Date().toISOString());
    if (!added) return 0;
    try { await write(service, next, version, owner); return added; } catch (error) { if (!(error instanceof ApiError && error.status === 409)) throw error; }
  }
  return 0;
}

const text = (max: number) => z.string().trim().min(1).max(max);
export const voiceDictionaryEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reading"), expectedVersion: z.number().int().min(0), from: text(60), to: text(120), was: z.string().trim().max(60).optional() }).strict(),
  z.object({ op: z.literal("reading_delete"), expectedVersion: z.number().int().min(0), from: text(60) }).strict(),
  z.object({ op: z.literal("test"), expectedVersion: z.number().int().min(0), id: z.string().trim().max(120).optional(), text: text(400),
    bind: z.array(z.string().trim().regex(/^[^|\s]+\|[^|\s]+$/, "붙여 읽을 자리는 「앞말|뒷말」로 써 주세요")).min(1).max(12), was: z.string().trim().max(400).default("") }).strict(),
  z.object({ op: z.literal("test_delete"), expectedVersion: z.number().int().min(0), id: text(120) }).strict(),
  z.object({ op: z.literal("confirm"), expectedVersion: z.number().int().min(0), kind: z.enum(["reading", "test"]), key: text(120) }).strict(),
]);

/** 「음성 사전」 screen: add, change, check (맞음) or remove one line; a person's line is never marked auto. */
export async function editVoiceDictionary(actor: RequestActor, input: z.infer<typeof voiceDictionaryEditSchema>) {
  const service = createServiceSupabase();
  const { dictionary, version } = await readVoiceDictionary(service);
  if (version !== input.expectedVersion) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  const at = new Date().toISOString(), by = actor.name;
  const next: VoiceDictionary = { readings: [...dictionary.readings], tests: [...dictionary.tests] };
  if (input.op === "reading") {
    const key = input.was ?? input.from;
    const row = { from: input.from, to: input.to, auto: false, source: "직접 입력", at, by };
    const at_ = next.readings.findIndex(item => item.from === key);
    if (at_ >= 0) next.readings[at_] = { ...next.readings[at_], ...row, source: next.readings[at_].source };
    else if (next.readings.some(item => item.from === input.from)) throw new ApiError(409, "VOICE_READING_EXISTS", "이미 있는 말이에요.");
    else if (next.readings.length >= VOICE_DICTIONARY_MAX.readings) throw new ApiError(409, "VOICE_DICTIONARY_FULL", "읽기 사전이 가득 찼어요.");
    else next.readings.push(row);
  } else if (input.op === "reading_delete") next.readings = next.readings.filter(item => item.from !== input.from);
  else if (input.op === "test") {
    const row = { id: input.id || `${at.slice(0, 10)}_${Math.random().toString(36).slice(2, 8)}`, text: input.text, bind: input.bind, was: input.was, from: "직접 입력", auto: false, at, by };
    const at_ = next.tests.findIndex(item => item.id === row.id);
    if (at_ >= 0) next.tests[at_] = { ...next.tests[at_], ...row, from: next.tests[at_].from };
    else if (next.tests.length >= VOICE_DICTIONARY_MAX.tests) throw new ApiError(409, "VOICE_DICTIONARY_FULL", "끊김 시험 문제가 가득 찼어요.");
    else next.tests.push(row);
  } else if (input.op === "test_delete") next.tests = next.tests.filter(item => item.id !== input.id);
  else if (input.kind === "reading") next.readings = next.readings.map(item => item.from === input.key ? { ...item, auto: false, at, by } : item);
  else next.tests = next.tests.map(item => item.id === input.key ? { ...item, auto: false, at, by } : item);
  const saved = await write(service, next, version, { id: actor.ownerId, team: actor.team });
  return { dictionary: next, version: saved };
}
