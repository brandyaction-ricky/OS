// 재료 고정 (유쓰 요청 3/8 보완, 2026-11-03): the versions of a v13 run's materials a result was made from, and which of them changed since.

export interface MyinMaterials { voice: string; storyboard: string; sound: string; subtitles: string; ours: string; style: string }

const NAMES: Record<keyof MyinMaterials, string> = { voice: "음성 · 받아쓰기", storyboard: "기획표", sound: "사운드", subtitles: "자막", ours: "우리 이미지", style: "채널 모양" };

/** The materials that differ now, by name (the sound matters only to the full video); null for a result made before they were kept. */
export function changedMaterials(used: MyinMaterials | undefined, now: MyinMaterials, sound = false) {
  if (!used) return null;
  return (Object.keys(NAMES) as (keyof MyinMaterials)[]).filter((key) => (sound || key !== "sound") && used[key] !== now[key]).map((key) => NAMES[key]);
}
