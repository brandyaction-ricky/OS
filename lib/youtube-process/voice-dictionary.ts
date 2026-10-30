// 음성 사전 (로건 OS 요청 2026-10-30, phase ④): the OS keeps his two dictionaries and the render PC reads the latest at every voice job.
// 읽기 사전 — a word as written → how Fish should say it (only the copy sent to Fish changes; script and subtitles stay).
// 끊김 시험 문제 — sentences that broke where they must not, with the places to read joined (his voice_regress runs them all whenever
// the voice pipeline changes). Lines the render PC adds itself (voice_fix) come in marked auto until a person checks them.
export interface VoiceReading { from: string; to: string; auto: boolean; source: string; at: string; by: string }
export interface VoiceTest { id: string; text: string; bind: string[]; was: string; from: string; auto: boolean; at: string; by: string }
export interface VoiceDictionary { readings: VoiceReading[]; tests: VoiceTest[] }
/** His file formats: 읽기사전.json {원래말: 읽는소리} (keys starting with _ are notes), 어색문장모음.json {items: […]}. */
export interface VoiceDictionaryFiles { readings: Record<string, string>; tests: { id: string; text: string; bind: string[]; was: string; from: string }[] }

export const VOICE_DICTIONARY_MAX = { readings: 500, tests: 300 };
const clip = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

/** What the render PC writes into a run's copy before it voices: everything the OS keeps, checked or not. */
export function dictionaryFiles(dictionary: VoiceDictionary): VoiceDictionaryFiles {
  return { readings: Object.fromEntries(dictionary.readings.map(row => [row.from, row.to])),
    tests: dictionary.tests.map(({ id, text, bind, was, from }) => ({ id, text, bind, was, from })) };
}

/**
 * The render PC's files after a job, merged into what the OS keeps: only lines the OS does not have are added — marked auto, or as
 * checked when the OS had nothing yet (his starting set). A line a person changed or removed is never brought back by a later report
 * of the same key, because the run's copy was written from the OS.
 */
export function mergeReported(dictionary: VoiceDictionary, reported: Partial<VoiceDictionaryFiles>, at: string): { next: VoiceDictionary; added: number } {
  const seed = !dictionary.readings.length && !dictionary.tests.length;
  const known = new Set(dictionary.readings.map(row => row.from)), ids = new Set(dictionary.tests.map(row => row.id));
  const readings = Object.entries(reported.readings ?? {}).filter(([from, to]) => !from.startsWith("_") && typeof to === "string" && clip(from, 60) && clip(to, 120) && !known.has(clip(from, 60)))
    .map(([from, to]) => ({ from: clip(from, 60), to: clip(to, 120), auto: !seed, source: seed ? "로건 기본 사전" : "음성 수정에서 자동 수집", at, by: seed ? "로건" : "영상 만드는 컴퓨터" }));
  const tests = (Array.isArray(reported.tests) ? reported.tests : []).filter(row => row && clip(row.id, 120) && clip(row.text, 400) && !ids.has(clip(row.id, 120)))
    .map(row => ({ id: clip(row.id, 120), text: clip(row.text, 400), bind: (Array.isArray(row.bind) ? row.bind : []).map(item => clip(item, 60)).filter(Boolean).slice(0, 12),
      was: clip(row.was, 400), from: clip(row.from, 200), auto: !seed, at, by: seed ? "로건" : "영상 만드는 컴퓨터" }));
  return { next: { readings: [...dictionary.readings, ...readings].slice(0, VOICE_DICTIONARY_MAX.readings), tests: [...dictionary.tests, ...tests].slice(0, VOICE_DICTIONARY_MAX.tests) },
    added: readings.length + tests.length };
}
