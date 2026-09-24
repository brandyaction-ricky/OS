/**
 * Restricted SVG fragment for one narrated visual beat. The model authors the
 * drawing; this module is the trust boundary shared by the server and the
 * offline renderer. Only a small, attribute-whitelisted SVG subset passes:
 * no scripts, links, external resources, styles, or foreign content.
 */

export const YOUTUBE_SCENE_PALETTE = {
  ink: "#191C1F", red: "#E12B31", pale: "#F6F6F3", muted: "#8A8F94", line: "#D8DADA", grey: "#C9CCCE", paper: "#FEFEFC",
} as const;
// The title band above y=180 belongs to the spoken headline.
export const YOUTUBE_SCENE_SAFE_AREA = { x1: 60, y1: 190, x2: 1220, y2: 690 } as const;
export const youtubeSceneClasses = ["i", "r", "thin", "bold", "p", "lab", "sm", "acc", "muted", "b7", "b8", "start", "end"] as const;
export const youtubeSceneMotions = ["draw", "fade", "grow-x", "grow-y", "character"] as const;

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/;
const POINTS = /^[0-9.,\s+-]+$/;
const TRANSFORM = /^(?:\s*(?:translate|scale|rotate)\(\s*-?[\d.]+(?:[\s,]+-?[\d.]+){0,2}\s*\)\s*)+$/;
const COLORS = new Set<string>([...Object.values(YOUTUBE_SCENE_PALETTE), "none"]);
const CLASSES = new Set<string>(youtubeSceneClasses);
const MOTIONS = new Set<string>(youtubeSceneMotions);
const number = (min: number, max: number) => (value: string) => NUMBER.test(value) && Number(value) >= min && Number(value) <= max;
const coordinate = number(-200, 1500);
const size = number(0, 1500);
const common: Record<string, (value: string) => boolean> = {
  class: (value) => value.trim().split(/\s+/).every((name) => CLASSES.has(name)),
  transform: (value) => value.length <= 120 && TRANSFORM.test(value),
  opacity: number(0, 1), fill: (value) => COLORS.has(value), stroke: (value) => COLORS.has(value),
  "stroke-width": number(1, 90), "data-k": (value) => MOTIONS.has(value), "data-s": number(0, 8), "data-d": number(0.05, 3),
};
const geometry: Record<string, Record<string, (value: string) => boolean>> = {
  g: {},
  path: { d: (value) => value.length <= 4_000 && PATH.test(value) },
  rect: { x: coordinate, y: coordinate, width: size, height: size, rx: number(0, 200), ry: number(0, 200) },
  circle: { cx: coordinate, cy: coordinate, r: number(0, 600) },
  ellipse: { cx: coordinate, cy: coordinate, rx: number(0, 700), ry: number(0, 700) },
  line: { x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate },
  polyline: { points: (value) => value.length <= 2_000 && POINTS.test(value) },
  polygon: { points: (value) => value.length <= 2_000 && POINTS.test(value) },
  text: { x: coordinate, y: coordinate, "text-anchor": (value) => ["start", "middle", "end"].includes(value), "font-size": number(16, 180) },
  tspan: { dx: number(-400, 400), dy: number(-200, 200), fill: (value) => COLORS.has(value) },
  image: { x: coordinate, y: coordinate, width: size, height: size, "data-character": (value) => /^[a-z0-9_-]{1,40}$/.test(value) },
};
const TEXT_PARENTS = new Set(["text", "tspan"]);

export type SceneSvgSummary = { characters: string[]; drawSeconds: number; elementCount: number };

export function validateSceneSvg(svg: string, characterIds: ReadonlySet<string>): { ok: true; summary: SceneSvgSummary } | { ok: false; error: string } {
  if (svg.length > 12_000) return { ok: false, error: "SVG가 너무 깁니다." };
  const stack: string[] = [];
  const characters: string[] = [];
  let drawSeconds = 0, elementCount = 0, cursor = 0;
  const token = /<(\/?)([a-z]+)((?:\s+[a-z][a-z0-9-]*="[^"<>]*")*)\s*(\/?)>|([^<]+)/gy;
  for (let match = token.exec(svg); match; match = token.exec(svg)) {
    cursor = token.lastIndex;
    const [, closing, tag, rawAttributes, selfClosing, text] = match;
    if (text !== undefined) {
      if (!text.trim()) continue;
      if (!TEXT_PARENTS.has(stack[stack.length - 1] ?? "")) return { ok: false, error: "글자는 text 요소 안에만 쓸 수 있습니다." };
      if (/&(?!(?:amp|lt|gt|quot|#39);)/.test(text) || text.trim().length > 40) return { ok: false, error: "도식 글자가 너무 길거나 허용되지 않는 문자를 포함합니다." };
      continue;
    }
    if (!(tag in geometry)) return { ok: false, error: `허용되지 않는 SVG 요소입니다: ${tag}` };
    if (closing) {
      if (rawAttributes || selfClosing || stack.pop() !== tag) return { ok: false, error: "SVG 태그 구조가 맞지 않습니다." };
      continue;
    }
    if (++elementCount > 160) return { ok: false, error: "SVG 요소가 너무 많습니다." };
    const attributes = new Map<string, string>();
    for (const [, name, value] of rawAttributes.matchAll(/\s+([a-z][a-z0-9-]*)="([^"]*)"/g)) {
      const check = geometry[tag][name] ?? common[name];
      if (!check || attributes.has(name) || !check(value)) return { ok: false, error: `${tag} 요소의 ${name} 값이 허용되지 않습니다.` };
      attributes.set(name, value);
    }
    const motion = attributes.get("data-k");
    if (tag === "image") {
      const id = attributes.get("data-character") ?? "";
      if (!characterIds.has(id) || motion !== "character" || !attributes.has("width") || !attributes.has("height"))
        return { ok: false, error: "캐릭터 그림은 등록된 id와 character 동작, 크기가 필요합니다." };
      characters.push(id);
    } else if (motion === "character") return { ok: false, error: "character 동작은 캐릭터 그림에만 씁니다." };
    if (motion && (!attributes.has("data-s") || !attributes.has("data-d"))) return { ok: false, error: "움직임에는 시작(data-s)과 길이(data-d)가 필요합니다." };
    if (motion) drawSeconds = Math.max(drawSeconds, Number(attributes.get("data-s")) + Number(attributes.get("data-d")));
    if (tag === "tspan" && stack[stack.length - 1] !== "text") return { ok: false, error: "tspan은 text 안에만 둡니다." };
    if (!selfClosing) stack.push(tag);
  }
  if (cursor !== svg.length || stack.length) return { ok: false, error: "SVG를 끝까지 읽지 못했습니다." };
  if (!elementCount || characters.length > 3) return { ok: false, error: "SVG 요소 또는 캐릭터 수가 허용 범위를 벗어났습니다." };
  return { ok: true, summary: { characters, drawSeconds, elementCount } };
}
