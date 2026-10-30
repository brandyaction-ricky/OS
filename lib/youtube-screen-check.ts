// 화면 자동 검사 (owner 2026-10-29, ④): GPT reads the render PC's 점검 시트 — Logan's preview() lays one frame per scene in a
// 3 × 4 grid with "#n" in red at each cell's bottom left — and names the scenes a person should look at before the full video.
import { z } from "zod";
import type { YpScreenCheck } from "./youtube-process/stages.ts";

export const SCREEN_KINDS = ["넘침", "겹침", "잘림", "빈 화면", "깨진 글자", "로고", "글자 많음", "기타"] as const;

/** Each scene's type and its words (cut short), so GPT can say which storyboard field to change. */
export function sceneHints(scenes: Record<string, unknown>[]) {
  const words = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(words)
    : value && typeof value === "object" ? Object.entries(value).filter(([key]) => !/^(image|images|file|photo|cam|t|t\d|at|src|url|key|focus_[xy])$/i.test(key)).flatMap(([, item]) => words(item)) : [];
  return scenes.map((scene, i) => `#${i + 1} ${String(scene.type ?? "")}: ${words(scene).join(" / ").replace(/\s+/g, " ").slice(0, 160)}`).join("\n");
}

export function screenPrompt(hints: string, short: boolean) {
  return `영상 하나의 점검 시트${short ? "(세로 숏폼)" : ""}입니다. 시트 한 장에 장면이 3열 × 4행으로 들어 있고, 칸마다 왼쪽 아래 빨간 「#번호」가 장면 번호입니다. 칸은 그 장면 도중의 한 순간입니다(쇼릴 뒤 장면은 조금 이른 순간이라 글자가 차례로 나오는 중일 수 있어요).

시청자 눈에 문제로 보일 장면만 골라 주세요. 볼 것:
- 넘침: 글자가 카드 · 상자 · 말풍선 · 화면 밖으로 나감
- 겹침: 글자끼리, 글자와 그림, 화면 글자와 아래 자막이 겹침
- 잘림: 인물 사진의 얼굴 · 머리 · 몸이 어색하게 잘림, 글자가 잘려 끝이 안 보임
- 빈 화면: 아무것도 없거나 회색 자리표시(사진을 못 받은 자리)만 있음. 제목만 있고 본문이 아직 없는 칸, 따옴표만 있는 칸은 글자가 나오는 중이라 적지 않음
- 깨진 글자: □ 같은 깨진 글자, 파일 이름 · 코드 · 영어 변수 이름이 화면에 보임
- 로고: 화면 구석의 MYIN 로고 · 표기 (진단 광고 · 마이인 사이트 화면 장면은 괜찮음)
- 글자 많음: 한 화면에 글자가 너무 많아 한눈에 안 읽힘
- 기타: 위에 없지만 분명히 이상한 것

지킬 것
- 확실히 보이는 것만 적습니다. 작아서 판단이 어려우면 적지 않습니다. 디자인 취향(색 · 글꼴 · 배치 선호)은 적지 않습니다.
- issue는 무엇이 어디서 문제인지 한 문장, fix는 장면 기획표에서 바꿀 것 한 문장(예: 「항목을 3개로 줄여요」, 「제목을 12자 안으로」, 「사진 세로 위치를 위로」).
- 문제가 없으면 scenes는 빈 목록입니다. note에는 전체를 한 줄로 적습니다.
- 쉬운 한국어로 씁니다.

아래는 장면 기획표의 장면 종류와 글자입니다(참고용 — 번호가 시트와 한두 칸 어긋날 수 있어 시트의 #번호를 기준으로 씁니다).
${hints}`;
}

export const SCREEN_SCHEMA = { type: "object", additionalProperties: false, required: ["scenes", "note"], properties: {
  scenes: { type: "array", items: { type: "object", additionalProperties: false, required: ["scene", "kind", "issue", "fix"], properties: {
    scene: { type: "integer" }, kind: { type: "string", enum: [...SCREEN_KINDS] }, issue: { type: "string" }, fix: { type: "string" } } } },
  note: { type: "string" } } };

const resultSchema = z.object({ scenes: z.array(z.object({ scene: z.number().int(), kind: z.string(), issue: z.string(), fix: z.string() })), note: z.string() });
const cut = (text: string, size = 300) => text.trim().slice(0, size);

/** GPT's answer as the stored check: scenes that exist, one line each, in scene order, at most 120 (a problem on every scene of a
 * 60-scene video, plus others); null when it is not that. */
export function parseScreen(text: string, sceneCount: number): Pick<YpScreenCheck, "scenes" | "note"> | null {
  let parsed: z.infer<typeof resultSchema>;
  try { parsed = resultSchema.parse(JSON.parse(text)); } catch { return null; }
  const scenes = parsed.scenes.filter((item) => item.scene >= 1 && (!sceneCount || item.scene <= sceneCount + 2) && item.issue.trim())
    .map((item) => ({ scene: item.scene, kind: (SCREEN_KINDS as readonly string[]).includes(item.kind) ? item.kind : "기타", issue: cut(item.issue), fix: cut(item.fix) }))
    .sort((a, b) => a.scene - b.scene).slice(0, 120);
  return { scenes, note: cut(parsed.note, 400) };
}

/** The card's lines: the same problem on many scenes (a logo on every scene) is one line with its scenes, not one line each. */
export function groupScreenIssues(scenes: YpScreenCheck["scenes"]) {
  const groups = new Map<string, { kind: string; issue: string; fix: string; scenes: number[] }>();
  for (const item of scenes) {
    const key = `${item.kind}\u0000${item.issue}\u0000${item.fix}`;
    const group = groups.get(key) ?? { kind: item.kind, issue: item.issue, fix: item.fix, scenes: [] };
    if (!group.scenes.includes(item.scene)) group.scenes.push(item.scene);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.scenes.length - b.scenes.length || a.scenes[0] - b.scenes[0]);
}
