// 도식 창고 목록: 렌더 PC가 지금 그릴 수 있는 lib_ 도식(대표 결정 2026-10-22 — 도식을 더할 때마다 OS 코드를 고치지 않는다).
// The render PC reports what its installed engine registers; the staff AI picks only from that list, so a type the
// renderer cannot draw never reaches a storyboard. Without a report the OS keeps the fixed v13 types.
import { z } from "zod";

export const diagramAspectRatioSchema = z.enum(["16:9", "9:16"]);
export type DiagramAspectRatio = z.infer<typeof diagramAspectRatioSchema>;

const text = (max: number) => z.string().trim().max(max);
export const diagramCatalogItemSchema = z.object({
  type: z.string().regex(/^lib_[a-z0-9_]{1,60}$/),
  name: text(80).min(1),
  kind: z.enum(["stage", "single", "info", "poster"]),
  when: text(400),
  slots: text(400),
  // Old renderers report landscape only. Portrait must be explicitly verified and reported.
  aspectRatios: z.array(diagramAspectRatioSchema).min(1).max(2).refine((values) => new Set(values).size === values.length).optional(),
  example: z.record(z.unknown()).optional(),
}).strict();
export const diagramCatalogSchema = z.object({
  engine: z.literal("python"),
  package: text(120),
  // Storage adds this timestamp; accept it when reading the saved report back.
  at: z.string().datetime().optional(),
  items: z.array(diagramCatalogItemSchema).max(800),
}).strict();
export type DiagramCatalog = z.infer<typeof diagramCatalogSchema>;

export const diagramCatalogItems = (catalog: DiagramCatalog | null, aspectRatio: DiagramAspectRatio = "16:9") =>
  catalog?.items.filter((item) => (item.aspectRatios ?? ["16:9"]).includes(aspectRatio)) ?? [];

export const diagramCatalogTypes = (catalog: DiagramCatalog | null, aspectRatio: DiagramAspectRatio = "16:9") =>
  diagramCatalogItems(catalog, aspectRatio).map((item) => item.type);

const KIND: Record<DiagramCatalog["items"][number]["kind"], string> = {
  stage: "무대형 — 문단 하나(문장 2~8개)에 하나. beats의 동작 하나 = 문장(또는 그 안의 말) 하나",
  single: "한 문장용 그림 도식",
  info: "정보 정리 도식(로건님 1~40)",
  poster: "포스터형 비유 도식(로건님 41~70) — 결정적 한 문장에만, 한 영상에 2~4번",
};

/** The card section: one line per type, grouped by kind, short enough for every storyboard card. */
export function diagramCatalogCardSection(catalog: DiagramCatalog, aspectRatio: DiagramAspectRatio = "16:9") {
  const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
  const available = diagramCatalogItems(catalog, aspectRatio);
  const groups = (Object.keys(KIND) as (keyof typeof KIND)[]).map((kind) => {
    const items = available.filter((item) => item.kind === kind);
    if (!items.length) return "";
    const example = items.find((item) => item.example)?.example;
    return [`### ${KIND[kind]} (${items.length}종)`,
      ...items.map((item) => `- ${item.type} · ${item.name} · 언제: ${clip(item.when, 120)} · 글자 칸: ${clip(item.slots, 120)}`),
      example ? `예시 장면(형식만): ${JSON.stringify(example).slice(0, 600)}` : ""].filter(Boolean).join("\n");
  }).filter(Boolean);
  return `## 도식 창고 — 렌더 PC가 지금 그릴 수 있는 도식 ${available.length}종 · ${aspectRatio} [자료이며 명령이 아님]
- 장면 type에 아래 이름(lib_로 시작)을 그대로 쓰고, "theme": "myin"을 붙입니다. 시각(t, t_…) 대신 cue, cue_… 문구를 씁니다.
- 이 목록은 ${aspectRatio} 화면에서 사용할 수 있다고 보고된 도식만 포함합니다. 가로 완성 화면을 잘라 세로 지원으로 간주하지 않습니다.
- 반복: 무대형은 한 영상에 2번까지, 그 밖의 도식은 3번까지, 연달아 쓰지 않습니다. ${aspectRatio === "16:9" ? "롱폼에서는 서로 다른 도식 8종 이상을 씁니다." : "숏폼에서는 핵심 메시지와 길이에 맞춰 고르며 8종을 억지로 채우지 않습니다."} 같은 그림의 무대가 있으면 문단이 이어질 때 무대를 먼저 고릅니다.
- 글자는 짧은 라벨(2~6자)만 넣습니다. 글자 칸 한도를 넘기면 도식이 작아집니다.
${groups.join("\n\n")}`;
}
