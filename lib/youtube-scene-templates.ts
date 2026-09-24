import { z } from "zod";
import { YOUTUBE_SCENE_PALETTE as C } from "./youtube-scene-svg";

/**
 * Fixed scene templates. The scene model only picks a template and fills its slots;
 * this module draws the SVG, so layout, element count and pacing stay consistent and
 * the model's output stays small. Coordinates live inside the renderer's safe area.
 */
export const youtubeSceneTemplates = [
  "question", "statement", "character_labels", "compare", "formula", "list",
  "bar_chart", "capture", "big_number", "quote", "line_chart", "donut",
] as const;
export type YoutubeSceneTemplate = typeof youtubeSceneTemplates[number];

const short = (max: number) => z.string().trim().min(1).max(max);
const accent = z.string().trim().max(14).optional();
const source = z.string().trim().max(36).optional();
const value = z.number().finite().nonnegative().max(1e9);

const slotSchemas = {
  question: z.object({ question: short(30), accent }),
  statement: z.object({ lines: z.array(short(16)).min(1).max(2), accent }),
  character_labels: z.object({ character: z.string().regex(/^[a-z0-9_-]{1,40}$/), labels: z.array(short(14)).min(1).max(2), accent }),
  compare: z.object({ a: short(10), aNote: z.string().trim().max(12).optional(), b: short(10), bNote: z.string().trim().max(12).optional(), pick: z.enum(["a", "b"]) }),
  formula: z.object({ a: short(8), b: short(8), result: short(8) }),
  list: z.object({ items: z.array(short(16)).min(2).max(4), pick: z.number().int().min(0).max(3).optional() }),
  bar_chart: z.object({ bars: z.array(z.object({ label: short(8), value })).min(2).max(4), unit: z.string().trim().max(4).optional(), highlight: z.number().int().min(0).max(3), source }),
  capture: z.object({ heading: short(22), lines: z.array(short(24)).min(1).max(2), source }),
  big_number: z.object({ value: short(10), caption: short(24), source }),
  quote: z.object({ lines: z.array(short(16)).min(1).max(2), accent, attribution: short(24) }),
  line_chart: z.object({ points: z.array(z.object({ label: z.string().trim().max(6).optional(), value })).min(3).max(8), highlightFrom: z.number().int().min(0).max(6), callout: short(10), source }),
  donut: z.object({ slices: z.array(z.object({ label: short(12), value })).min(2).max(3), highlight: z.number().int().min(0).max(2), center: short(6), source }),
} satisfies Record<YoutubeSceneTemplate, z.ZodType>;

export type CharacterSizes = ReadonlyMap<string, { width: number; height: number }>;

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Hangul glyphs are about 1em wide; digits, Latin and spaces about 0.56em.
const ems = (text: string) => [...text].reduce((sum, ch) => sum + (/[ㄱ-힝]/.test(ch) ? 1 : 0.56), 0);
const fit = (text: string, maxWidth: number, size: number, min = 22) => Math.max(min, Math.min(size, Math.floor(maxWidth / Math.max(1, ems(text)))));
const n = (value: number) => Math.round(value * 10) / 10;
const motion = (kind: string, start: number, duration = 0.3) => `data-k="${kind}" data-s="${n(start)}" data-d="${duration}"`;

/** Text with an optional red accent word. Classes: b7/b8 weight, start/end anchor, acc red, muted grey. */
function text(x: number, y: number, size: number, body: string, cls: string, start: number, accentWord?: string) {
  const at = accentWord ? body.indexOf(accentWord) : -1;
  const inner = at < 0 || !accentWord ? esc(body)
    : `${esc(body.slice(0, at))}<tspan class="acc">${esc(accentWord)}</tspan>${esc(body.slice(at + accentWord.length))}`;
  return `<text${cls ? ` class="${cls}"` : ""} x="${n(x)}" y="${n(y)}" font-size="${size}" ${motion("fade", start)}>${inner}</text>`;
}
const sourceLine = (label: string | undefined, start: number) => label ? text(1210, 668, 22, label, "sm end", start) : "";
const highest = (values: number[]) => Math.max(...values, 1e-9);

function draw(template: YoutubeSceneTemplate, slots: never, sizes: CharacterSizes): string {
  switch (template) {
    case "question": {
      const s = slots as z.infer<typeof slotSchemas.question>;
      return `<rect class="p" x="200" y="270" width="880" height="200" rx="28" stroke="${C.line}" stroke-width="3" ${motion("fade", 0)}/>`
        + `<circle cx="266" cy="328" r="24" fill="${C.line}" ${motion("fade", 0.1)}/>`
        + text(304, 328, 24, "질문", "sm start", 0.1)
        + text(640, 405, fit(s.question, 800, 46), s.question, "b8", 0.25, s.accent);
    }
    case "statement": {
      const s = slots as z.infer<typeof slotSchemas.statement>;
      const size = Math.min(...s.lines.map((line) => fit(line, 1000, 68)));
      const ys = s.lines.length === 1 ? [420] : [370, 470];
      let out = s.lines.map((line, i) => text(640, ys[i], size, line, "b8", 0.15 * i, s.accent)).join("");
      const row = s.accent ? s.lines.findIndex((line) => line.includes(s.accent!)) : -1;
      if (row >= 0) {
        const line = s.lines[row], left = 640 - (ems(line) * size) / 2 + ems(line.slice(0, line.indexOf(s.accent!))) * size;
        out += `<path class="r bold" d="M${n(left)} ${ys[row] + size * 0.62}H${n(left + ems(s.accent!) * size)}" ${motion("draw", 0.7, 0.35)}/>`;
      }
      return out;
    }
    case "character_labels": {
      const s = slots as z.infer<typeof slotSchemas.character_labels>;
      const size = sizes.get(s.character);
      if (!size) throw new Error("unknown character");
      const scale = Math.min(580 / size.width, 460 / size.height), w = size.width * scale, h = size.height * scale;
      const image = `<image data-character="${s.character}" x="${n(80 + (580 - w) / 2)}" y="${n(200 + (460 - h) / 2)}" width="${n(w)}" height="${n(h)}" ${motion("character", 0, 0.7)}/>`;
      const ys = s.labels.length === 1 ? [430] : [370, 490];
      return image + s.labels.map((label, i) => text(720, ys[i], fit(label, 470, 44), label, "b7 start", 0.5 + 0.7 * i, s.accent)).join("");
    }
    case "compare": {
      const s = slots as z.infer<typeof slotSchemas.compare>;
      const box = (x: number, title: string, note: string | undefined, picked: boolean, start: number) =>
        `<rect class="i" x="${x}" y="250" width="400" height="260" rx="24" ${motion("fade", start)}/>`
        + text(x + 200, note ? 355 : 380, fit(title, 340, 46), title, picked ? "b8" : "b8 muted", start)
        + (note ? text(x + 200, 425, 28, note, picked ? "" : "muted", start) : "");
      const pickX = s.pick === "a" ? 156 : 696;
      return box(170, s.a, s.aNote, s.pick === "a", 0) + text(640, 380, 40, "vs", "b8 muted", 0.3)
        + box(710, s.b, s.bNote, s.pick === "b", 0.6)
        + `<rect class="r" x="${pickX}" y="236" width="428" height="288" rx="32" ${motion("draw", 1.1, 0.4)}/>`;
    }
    case "formula": {
      const s = slots as z.infer<typeof slotSchemas.formula>;
      const cell = (cx: number, label: string, start: number, result = false) =>
        `<rect class="${result ? "r" : "p"}" x="${cx - 150}" y="320" width="300" height="130" rx="20" ${motion("fade", start)}/>`
        + text(cx, 385, fit(label, 260, 40), label, result ? "acc" : "b8", start);
      return cell(250, s.a, 0) + text(445, 385, 52, "+", "b8", 0.4) + cell(640, s.b, 0.6)
        + text(835, 385, 52, "=", "b8", 1.0) + cell(1030, s.result, 1.2, true);
    }
    case "list": {
      const s = slots as z.infer<typeof slotSchemas.list>;
      const size = Math.min(...s.items.map((item, i) => fit(`${i + 1}. ${item}`, 700, 46)));
      const top = 430 - ((s.items.length - 1) * 100) / 2;
      let out = s.items.map((item, i) => text(360, top + i * 100, size, `${i + 1}. ${item}`, "b7 start", 0.4 * i)).join("");
      if (s.pick !== undefined && s.pick < s.items.length) {
        const width = ems(`${s.pick + 1}. ${s.items[s.pick]}`) * size;
        out += `<ellipse class="r" cx="${n(360 + width / 2)}" cy="${n(top + s.pick * 100)}" rx="${n(width / 2 + 40)}" ry="48" ${motion("draw", 0.4 * s.items.length + 0.3, 0.4)}/>`;
      }
      return out;
    }
    case "bar_chart": {
      const s = slots as z.infer<typeof slotSchemas.bar_chart>;
      const max = highest(s.bars.map((bar) => bar.value)), gap = 680 / s.bars.length;
      let out = `<path class="i thin" d="M260 580H1020" ${motion("draw", 0, 0.3)}/>`;
      s.bars.forEach((bar, i) => {
        const cx = 260 + gap * (i + 0.5), h = Math.max(6, (bar.value / max) * 300), hot = i === s.highlight;
        out += `<rect x="${n(cx - 60)}" y="${n(580 - h)}" width="120" height="${n(h)}" rx="6" fill="${hot ? C.red : C.grey}" ${motion("grow-y", 0.2 + 0.25 * i, 0.4)}/>`
          + text(cx, 580 - h - 26, 30, `${bar.value}${s.unit ?? ""}`, hot ? "acc" : "b8", 0.5 + 0.25 * i)
          + text(cx, 618, fit(bar.label, gap - 20, 28), bar.label, "", 0.2 + 0.25 * i);
      });
      return out + sourceLine(s.source, 1.2);
    }
    case "capture": {
      const s = slots as z.infer<typeof slotSchemas.capture>;
      const quoteTop = 370, size = Math.min(...s.lines.map((line) => fit(line, 620, 30)));
      return `<g transform="rotate(-2 640 420)">`
        + `<rect x="260" y="200" width="760" height="440" rx="10" fill="${C.paper}" stroke="${C.line}" stroke-width="3" ${motion("fade", 0)}/>`
        + `<rect x="260" y="200" width="760" height="44" rx="10" fill="${C.pale}" ${motion("fade", 0)}/>`
        + text(310, 290, fit(s.heading, 660, 34), s.heading, "b8 start", 0.15)
        + `<rect x="310" y="318" width="620" height="12" rx="6" fill="${C.line}" ${motion("fade", 0.2)}/>`
        + s.lines.map((line, i) => text(310, quoteTop + i * 44, size, line, "b7 start", 0.3)).join("")
        + `<rect x="310" y="${quoteTop + s.lines.length * 44}" width="560" height="12" rx="6" fill="${C.line}" ${motion("fade", 0.3)}/>`
        + `<rect x="310" y="${quoteTop + s.lines.length * 44 + 30}" width="480" height="12" rx="6" fill="${C.line}" ${motion("fade", 0.3)}/>`
        + `<rect class="r" x="296" y="${quoteTop - 32}" width="650" height="${s.lines.length * 44 + 20}" rx="8" ${motion("draw", 1.0, 0.4)}/>`
        + `</g>` + sourceLine(s.source, 0.4);
    }
    case "big_number": {
      const s = slots as z.infer<typeof slotSchemas.big_number>;
      return text(640, 390, fit(s.value, 1000, 170, 60), s.value, "acc", 0, undefined)
        + text(640, 520, fit(s.caption, 900, 40), s.caption, "b7", 0.5) + sourceLine(s.source, 0.7);
    }
    case "quote": {
      const s = slots as z.infer<typeof slotSchemas.quote>;
      const size = Math.min(...s.lines.map((line) => fit(line, 820, 46)));
      const ys = s.lines.length === 1 ? [380] : [345, 415];
      const last = ys[ys.length - 1] + 70;
      return text(250, 300, 110, "“", "acc start", 0)
        + s.lines.map((line, i) => text(320, ys[i], size, line, "b8 start", 0.2 + 0.2 * i, s.accent)).join("")
        + `<path class="i thin" d="M320 ${last}H400" ${motion("draw", 0.7, 0.3)}/>`
        + text(420, last, 28, s.attribution, "muted start", 0.8);
    }
    case "line_chart": {
      const s = slots as z.infer<typeof slotSchemas.line_chart>;
      const values = s.points.map((point) => point.value), max = highest(values), min = Math.min(...values);
      const span = max - min || 1, step = 680 / (s.points.length - 1);
      const xy = s.points.map((point, i) => [300 + step * i, 560 - ((point.value - min) / span) * 300] as const);
      const pts = (list: typeof xy) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
      const from = Math.min(s.highlightFrom, s.points.length - 2), [lx, ly] = xy[xy.length - 1];
      const first = s.points[0].label, lastLabel = s.points[s.points.length - 1].label;
      return `<path class="i thin" d="M260 590H1020M260 590V230" ${motion("draw", 0, 0.3)}/>`
        + `<polyline points="${pts(xy)}" fill="none" stroke="${C.grey}" stroke-width="6" ${motion("draw", 0.2, 0.7)}/>`
        + `<polyline class="r bold" points="${pts(xy.slice(from))}" ${motion("draw", 0.9, 0.4)}/>`
        + `<circle cx="${n(lx)}" cy="${n(ly)}" r="11" fill="${C.red}" ${motion("fade", 1.2)}/>`
        + text(Math.min(lx, 1120), Math.max(ly - 34, 214), fit(s.callout, 220, 28), s.callout, "acc", 1.3)
        + (first ? text(300, 624, 24, first, "muted", 0.2) : "") + (lastLabel ? text(980, 624, 24, lastLabel, "muted", 0.2) : "")
        + sourceLine(s.source, 1.4);
    }
    case "donut": {
      const s = slots as z.infer<typeof slotSchemas.donut>;
      const total = s.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
      const order = [s.highlight, ...s.slices.map((_, i) => i).filter((i) => i !== s.highlight)].filter((i) => i < s.slices.length);
      const cx = 460, cy = 430, r = 150;
      const point = (turn: number) => [cx + r * Math.sin(turn * 2 * Math.PI), cy - r * Math.cos(turn * 2 * Math.PI)];
      let at = 0, out = "";
      order.forEach((index, k) => {
        const part = Math.min(s.slices[index].value / total, 0.9999), [x1, y1] = point(at), [x2, y2] = point(at + part);
        const color = k === 0 ? C.red : k === 1 ? C.grey : C.line;
        out += `<path d="M${n(x1)} ${n(y1)}A${r} ${r} 0 ${part > 0.5 ? 1 : 0} 1 ${n(x2)} ${n(y2)}" fill="none" stroke="${color}" stroke-width="70" ${motion("draw", 0.2 + 0.4 * k, 0.5)}/>`;
        at += part;
      });
      out += text(cx, cy, fit(s.center, 200, 60), s.center, "acc", 0.8);
      const top = 430 - ((order.length - 1) * 80) / 2;
      order.forEach((index, k) => {
        out += `<rect x="760" y="${n(top + k * 80 - 14)}" width="28" height="28" rx="6" fill="${k === 0 ? C.red : k === 1 ? C.grey : C.line}" ${motion("fade", 0.9)}/>`
          + text(805, top + k * 80, fit(s.slices[index].label, 400, 34), s.slices[index].label, k === 0 ? "b7 start" : "b7 start muted", 0.9);
      });
      return out + sourceLine(s.source, 1.1);
    }
  }
}

/** Draw one beat from a template and its slots; throws when the slots do not fit the template. */
export function renderSceneTemplate(template: string, slots: unknown, sizes: CharacterSizes) {
  if (!(youtubeSceneTemplates as readonly string[]).includes(template)) throw new Error(`unknown template ${template}`);
  const name = template as YoutubeSceneTemplate;
  const parsed = slotSchemas[name].safeParse(slots);
  if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return draw(name, parsed.data as never, sizes);
}

/** Model-facing description of every template and its slots. */
export const SCENE_TEMPLATE_GUIDE = `question: 새 이야기 덩어리를 여는 질문 카드. {"question": "30자 이내 질문", "accent"?: "질문 속 빨간 단어"}
statement: 결론·주장을 못 박는 큰 문장. {"lines": ["16자 이내", "선택 둘째 줄"], "accent"?: "빨간 밑줄 단어"}
character_labels: 채널 캐릭터 + 라벨 1~2개로 감정·상황. {"character": "목록의 id", "labels": ["14자 이내", "선택"], "accent"?: "라벨 속 빨간 단어"}
compare: 흔한 생각 vs 진짜 답. {"a": "10자", "aNote"?: "12자", "b": "10자", "bNote"?: "12자", "pick": "a|b"}
formula: 원인을 A + B = C 한 줄로. {"a": "8자", "b": "8자", "result": "8자"}
list: 항목 2~4개를 나열하고 하나를 짚음. {"items": ["16자 이내", ...], "pick"?: 0부터 시작하는 번호}
bar_chart: 수치 비교(막대 2~4개). {"bars": [{"label": "8자", "value": 숫자}], "unit"?: "4자", "highlight": 번호, "source"?: "출처"}
capture: 기사·논문·자료의 핵심 문장 강조. {"heading": "자료 제목 22자", "lines": ["자료 속 문장 24자", "선택"], "source"?: "출처"}
big_number: 수치 하나를 크게. {"value": "10명 중 7명 같은 10자", "caption": "의미 24자", "source"?: "출처"}
quote: 연구·책의 인용. {"lines": ["16자", "선택"], "accent"?: "빨간 단어", "attribution": "누가, 언제 24자"}
line_chart: 시간에 따른 변화(점 3~8개). {"points": [{"label"?: "6자", "value": 숫자}], "highlightFrom": 빨간 구간 시작 번호, "callout": "핵심 지점 10자", "source"?: "출처"}
donut: 비율·구성(조각 2~3개). {"slices": [{"label": "12자", "value": 숫자}], "highlight": 번호, "center": "가운데 6자", "source"?: "출처"}`;
