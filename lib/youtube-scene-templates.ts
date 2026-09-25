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
  "steps", "cycle", "balance", "funnel", "venn", "ranking",
  "character_only", "split", "caption_only", "cards", "phone",
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
  list: z.object({ title: z.string().trim().max(20).optional(), items: z.array(short(16)).min(2).max(5), pick: z.number().int().min(0).max(4).optional() }),
  bar_chart: z.object({ bars: z.array(z.object({ label: short(8), value })).min(2).max(4), unit: z.string().trim().max(4).optional(), highlight: z.number().int().min(0).max(3), source }),
  capture: z.object({ heading: short(22), lines: z.array(short(24)).min(1).max(2), source }),
  big_number: z.object({ value: short(10), caption: short(24), source }),
  quote: z.object({ lines: z.array(short(16)).min(1).max(2), accent, attribution: short(24) }),
  line_chart: z.object({ points: z.array(z.object({ label: z.string().trim().max(6).optional(), value })).min(3).max(8), highlightFrom: z.number().int().min(0).max(6), callout: short(10), source }),
  donut: z.object({ slices: z.array(z.object({ label: short(12), value })).min(2).max(3), highlight: z.number().int().min(0).max(2), center: short(6), source }),
  steps: z.object({ steps: z.array(short(8)).min(2).max(4), pick: z.number().int().min(0).max(3).optional() }),
  cycle: z.object({ nodes: z.array(short(6)).min(3).max(4), center: z.string().trim().max(8).optional() }),
  balance: z.object({ left: short(8), right: short(8), heavier: z.enum(["left", "right", "even"]) }),
  funnel: z.object({ items: z.array(short(6)).min(2).max(4), result: short(10) }),
  venn: z.object({ a: short(8), b: short(8), both: short(8) }),
  ranking: z.object({ first: short(8), second: short(8), third: z.string().trim().max(8).optional() }),
  character_only: z.object({ character: z.string().regex(/^[a-z0-9_-]{1,40}$/), label: z.string().trim().max(16).optional() }),
  split: z.object({ left: short(12), leftNote: z.string().trim().max(16).optional(), right: short(12), rightNote: z.string().trim().max(16).optional() }),
  caption_only: z.object({}),
  cards: z.object({ items: z.array(short(8)).min(2).max(6) }),
  phone: z.object({ screen: short(14), sub: z.string().trim().max(14).optional(), side: z.string().trim().max(12).optional(), sideAccent: z.string().trim().max(14).optional() }),
} satisfies Record<YoutubeSceneTemplate, z.ZodType>;

export type CharacterSizes = ReadonlyMap<string, { width: number; height: number }>;

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Hangul glyphs are about 1em wide; digits, Latin and spaces about 0.56em.
const ems = (text: string) => [...text].reduce((sum, ch) => sum + (/[ㄱ-힝]/.test(ch) ? 1 : 0.56), 0);
const fit = (text: string, maxWidth: number, size: number, min = 22) => Math.max(min, Math.min(size, Math.floor(maxWidth / Math.max(1, ems(text)))));
const n = (value: number) => Math.round(value * 10) / 10;
/**
 * Motion for one element of reveal group g. The renderer starts group g when its spoken cue is heard
 * (or at g × 0.45 s without cues); d is a short delay inside the group.
 */
const m = (kind: string, g: number, d = 0, duration = 0.3) => `data-k="${kind}" data-g="${g}" data-s="${n(d)}" data-d="${duration}"`;

/** Text with an optional red accent word. Classes: b7/b8 weight, start/end anchor, acc red, muted grey. */
function text(x: number, y: number, size: number, body: string, cls: string, g: number, accentWord?: string, underline = false, d = 0) {
  const at = accentWord ? body.indexOf(accentWord) : -1;
  const inner = at < 0 || !accentWord ? esc(body)
    : `${esc(body.slice(0, at))}<tspan class="acc${underline ? " ul" : ""}">${esc(accentWord)}</tspan>${esc(body.slice(at + accentWord.length))}`;
  return `<text${cls ? ` class="${cls}"` : ""} x="${n(x)}" y="${n(y)}" font-size="${size}" ${m("fade", g, d)}>${inner}</text>`;
}
const sourceLine = (label: string | undefined, g: number, x = 1020, y = 668, cls = "sm end") => label ? text(x, y, 22, label, cls, g, undefined, false, 0.3) : "";
const highest = (values: number[]) => Math.max(...values, 1e-9);
/** Dark rounded label with white text, centred on (cx, cy). */
const pill = (cx: number, cy: number, label: string, g: number, size = 30, red = false) => {
  const w = ems(label) * size + 56, h = size + 30;
  return `<rect x="${n(cx - w / 2)}" y="${n(cy - h / 2)}" width="${n(w)}" height="${h}" rx="${h / 2}" fill="${red ? C.red : C.ink}" ${m("fade", g)}/>`
    + text(cx, cy, size, label, "b8 inv", g);
};
/** Break a line near its middle space when it is too long for one row. */
const wrap = (line: string, max: number) => {
  if (line.length <= max) return [line];
  const spaces = [...line].map((ch, i) => (ch === " " ? i : -1)).filter((i) => i > 0);
  const cut = spaces.sort((a, b) => Math.abs(a - line.length / 2) - Math.abs(b - line.length / 2))[0];
  return cut ? [line.slice(0, cut), line.slice(cut + 1)] : [line];
};
/** Character art large and bottom-anchored; it bleeds past the frame edge like a bust shot. */
const bust = (id: string, sizes: CharacterSizes, cx: number, width: number) => {
  const size = sizes.get(id);
  if (!size) throw new Error("unknown character");
  const w = Math.min(width, (640 * size.width) / size.height), h = (w * size.height) / size.width;
  return `<image data-character="${id}" class="bleed" x="${n(cx - w / 2)}" y="${n(800 - h)}" width="${n(w)}" height="${n(h)}" ${m("character", 0, 0, 0.7)}/>`;
};

/** Reveal groups per template, in the order they should appear with the narration. */
export function sceneTemplateCueCount(template: YoutubeSceneTemplate, slots: Record<string, unknown>) {
  const len = (key: string) => (Array.isArray(slots[key]) ? (slots[key] as unknown[]).length : 0);
  switch (template) {
    case "question": case "caption_only": return 1;
    case "character_only": return slots.label ? 2 : 1;
    case "cards": return len("items");
    case "phone": return slots.side || slots.sideAccent ? 2 : 1;
    case "split": return 2;
    case "statement": return len("lines");
    case "character_labels": return 1 + len("labels");
    case "list": return len("items");
    case "bar_chart": return len("bars");
    case "steps": return len("steps");
    case "cycle": return len("nodes");
    case "ranking": return slots.third ? 3 : 2;
    case "compare": case "formula": case "balance": case "venn": return 3;
    default: return 2;
  }
}

function draw(template: YoutubeSceneTemplate, slots: never, sizes: CharacterSizes): string {
  switch (template) {
    case "question": {
      const s = slots as z.infer<typeof slotSchemas.question>;
      const lines = wrap(s.question, 16), size = Math.min(...lines.map((line) => fit(line, 760, 46, 30)));
      const w = Math.max(520, Math.max(...lines.map(ems)) * size + 130), h = 150 + lines.length * 62;
      return `<rect x="206" y="236" width="${n(w)}" height="${h}" rx="26" fill="${C.line}" ${m("fade", 0)}/>`
        + `<rect x="200" y="228" width="${n(w)}" height="${h}" rx="26" fill="${C.paper}" stroke="${C.line}" stroke-width="3" ${m("fade", 0)}/>`
        + `<circle cx="264" cy="292" r="26" fill="${C.grey}" ${m("fade", 0)}/>`
        + text(306, 292, 24, "시청자 질문", "muted start b7", 0)
        + lines.map((line, i) => text(264, 372 + i * 62, size, line, "b8 start", 0, s.accent, false, 0.15 + 0.1 * i)).join("");
    }
    case "statement": {
      const s = slots as z.infer<typeof slotSchemas.statement>;
      const size = Math.min(...s.lines.map((line) => fit(line, 1100, 88, 44)));
      // Two lines: the second line carries the point in red with a hand-drawn underline.
      if (s.lines.length === 2) return text(640, 370, size, s.lines[0], "b8", 0) + text(640, 370 + size * 1.25, size, s.lines[1], "b8", 1, s.lines[1], true);
      return text(640, 420, size, s.lines[0], "b8", 0, s.accent, true);
    }
    case "character_labels": {
      const s = slots as z.infer<typeof slotSchemas.character_labels>;
      return bust(s.character, sizes, 440, 800) + s.labels.map((label, i) => pill(930, 280 + i * 110, label, i + 1, 34, Boolean(s.accent && label.includes(s.accent)))).join("");
    }
    case "compare": {
      const s = slots as z.infer<typeof slotSchemas.compare>;
      const box = (x: number, title: string, note: string | undefined, picked: boolean, g: number) =>
        `<rect class="i" x="${x}" y="250" width="400" height="260" rx="24" ${m("fade", g)}/>`
        + text(x + 200, note ? 355 : 380, fit(title, 340, 46), title, picked ? "b8" : "b8 muted", g)
        + (note ? text(x + 200, 425, 28, note, picked ? "" : "muted", g) : "");
      const pickX = s.pick === "a" ? 156 : 696;
      return box(170, s.a, s.aNote, s.pick === "a", 0) + text(640, 380, 40, "vs", "b8 muted", 1)
        + box(710, s.b, s.bNote, s.pick === "b", 1)
        + `<rect class="r" x="${pickX}" y="236" width="428" height="288" rx="32" ${m("draw", 2, 0, 0.4)}/>`;
    }
    case "formula": {
      const s = slots as z.infer<typeof slotSchemas.formula>;
      const cell = (cx: number, label: string, g: number, result = false) =>
        `<rect class="${result ? "r" : "p"}" x="${cx - 150}" y="320" width="300" height="130" rx="20" ${m("fade", g)}/>`
        + text(cx, 385, fit(label, 260, 40), label, result ? "acc" : "b8", g);
      return cell(250, s.a, 0) + text(445, 385, 52, "+", "b8", 1) + cell(640, s.b, 1)
        + text(835, 385, 52, "=", "b8", 2) + cell(1030, s.result, 2, true);
    }
    case "list": {
      const s = slots as z.infer<typeof slotSchemas.list>;
      const size = Math.min(...s.items.map((item) => fit(item, 640, 40, 28))), top = s.title ? 330 : 280, height = top - 170 + (s.items.length - 1) * 76 + 56;
      let out = `<rect x="230" y="170" width="820" height="${height}" rx="18" fill="${C.paper}" stroke="${C.line}" stroke-width="3" ${m("fade", 0)}/>`
        + `<path d="M232 214H1048" stroke="${C.line}" stroke-width="2" ${m("fade", 0)}/>`
        + [262, 286, 310].map((x) => `<circle cx="${x}" cy="192" r="7" fill="${C.grey}" ${m("fade", 0)}/>`).join("")
        + text(640, 192, 18, "메모", "muted", 0);
      if (s.title) out += text(280, 268, fit(s.title, 720, 40, 28), s.title, "b8 start", 0, undefined, false, 0.1);
      s.items.forEach((item, i) => {
        const y = top + i * 76, hot = i === s.pick;
        out += `<circle class="${hot ? "r" : "i"}" cx="296" cy="${y}" r="14" ${m("draw", i, 0, 0.25)}/>`
          + (hot ? `<circle cx="296" cy="${y}" r="6" fill="${C.red}" ${m("fade", i, 0.1)}/>` : "")
          + text(330, y, size, item, hot ? "acc start" : "b7 start", i, undefined, false, 0.1);
      });
      return out;
    }
    case "bar_chart": {
      const s = slots as z.infer<typeof slotSchemas.bar_chart>;
      const max = highest(s.bars.map((bar) => bar.value)), gap = 680 / s.bars.length;
      let out = `<path class="i thin" d="M260 580H1020" ${m("draw", 0)}/>`;
      s.bars.forEach((bar, i) => {
        const cx = 260 + gap * (i + 0.5), h = Math.max(6, (bar.value / max) * 300), hot = i === s.highlight;
        out += `<rect x="${n(cx - 60)}" y="${n(580 - h)}" width="120" height="${n(h)}" rx="6" fill="${hot ? C.red : C.grey}" ${m("grow-y", i, 0.1, 0.4)}/>`
          + text(cx, 580 - h - 26, 30, `${bar.value}${s.unit ?? ""}`, hot ? "acc" : "b8", i, undefined, false, 0.4)
          + text(cx, 618, fit(bar.label, gap - 20, 28), bar.label, "", i);
      });
      return out + sourceLine(s.source, 0);
    }
    case "capture": {
      const s = slots as z.infer<typeof slotSchemas.capture>;
      const quoteTop = 370, size = Math.min(...s.lines.map((line) => fit(line, 620, 30)));
      return `<g transform="rotate(-2 640 420)">`
        + `<rect x="260" y="200" width="760" height="440" rx="10" fill="${C.paper}" stroke="${C.line}" stroke-width="3" ${m("fade", 0)}/>`
        + `<rect x="260" y="200" width="760" height="44" rx="10" fill="${C.pale}" ${m("fade", 0)}/>`
        + text(310, 290, fit(s.heading, 660, 34), s.heading, "b8 start", 0, undefined, false, 0.1)
        + `<rect x="310" y="318" width="620" height="12" rx="6" fill="${C.line}" ${m("fade", 0, 0.15)}/>`
        + s.lines.map((line, i) => text(310, quoteTop + i * 44, size, line, "b7 start", 0, undefined, false, 0.2)).join("")
        + `<rect x="310" y="${quoteTop + s.lines.length * 44}" width="560" height="12" rx="6" fill="${C.line}" ${m("fade", 0, 0.2)}/>`
        + `<rect x="310" y="${quoteTop + s.lines.length * 44 + 30}" width="480" height="12" rx="6" fill="${C.line}" ${m("fade", 0, 0.2)}/>`
        + `<rect class="r" x="296" y="${quoteTop - 32}" width="650" height="${s.lines.length * 44 + 20}" rx="8" ${m("draw", 1, 0, 0.4)}/>`
        + `</g>` + sourceLine(s.source, 0);
    }
    case "big_number": {
      const s = slots as z.infer<typeof slotSchemas.big_number>;
      return text(640, 390, fit(s.value, 1000, 170, 60), s.value, "acc", 0)
        + text(640, 520, fit(s.caption, 900, 40), s.caption, "b7", 1) + sourceLine(s.source, 1, 640, 590, "sm");
    }
    case "quote": {
      const s = slots as z.infer<typeof slotSchemas.quote>;
      const size = Math.min(...s.lines.map((line) => fit(line, 820, 46)));
      const ys = s.lines.length === 1 ? [380] : [345, 415];
      const last = ys[ys.length - 1] + 70;
      return text(250, 300, 110, "“", "acc start", 0)
        + s.lines.map((line, i) => text(320, ys[i], size, line, "b8 start", 0, s.accent, false, 0.15 * i)).join("")
        + `<path class="i thin" d="M320 ${last}H400" ${m("draw", 1)}/>`
        + text(420, last, 28, s.attribution, "muted start", 1, undefined, false, 0.1);
    }
    case "line_chart": {
      const s = slots as z.infer<typeof slotSchemas.line_chart>;
      const values = s.points.map((point) => point.value), max = highest(values), min = Math.min(...values);
      const span = max - min || 1, step = 680 / (s.points.length - 1);
      const xy = s.points.map((point, i) => [300 + step * i, 560 - ((point.value - min) / span) * 300] as const);
      const pts = (list: typeof xy) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
      const from = Math.min(s.highlightFrom, s.points.length - 2), [lx, ly] = xy[xy.length - 1];
      const first = s.points[0].label, lastLabel = s.points[s.points.length - 1].label;
      return `<path class="i thin" d="M260 590H1020M260 590V230" ${m("draw", 0)}/>`
        + `<polyline points="${pts(xy)}" fill="none" stroke="${C.grey}" stroke-width="6" ${m("draw", 0, 0.2, 0.7)}/>`
        + `<polyline class="r bold" points="${pts(xy.slice(from))}" ${m("draw", 1, 0, 0.4)}/>`
        + `<circle cx="${n(lx)}" cy="${n(ly)}" r="11" fill="${C.red}" ${m("fade", 1, 0.3)}/>`
        + text(Math.min(lx, 1120), Math.max(ly - 34, 214), fit(s.callout, 220, 28), s.callout, "acc", 1, undefined, false, 0.4)
        + (first ? text(300, 624, 24, first, "muted", 0) : "") + (lastLabel ? text(980, 624, 24, lastLabel, "muted", 0) : "")
        + sourceLine(s.source, 0);
    }
    case "donut": {
      const s = slots as z.infer<typeof slotSchemas.donut>;
      const total = s.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
      const order = [s.highlight, ...s.slices.map((_, i) => i).filter((i) => i !== s.highlight)].filter((i) => i < s.slices.length);
      const cx = 460, cy = 430, r = 150;
      const point = (turn: number) => [cx + r * Math.sin(turn * 2 * Math.PI), cy - r * Math.cos(turn * 2 * Math.PI)];
      const group = (k: number) => (k === 0 ? 1 : 0);
      let at = 0, out = "";
      order.forEach((index, k) => {
        const part = Math.min(s.slices[index].value / total, 0.9999), [x1, y1] = point(at), [x2, y2] = point(at + part);
        const color = k === 0 ? C.red : k === 1 ? C.grey : C.line;
        out += `<path d="M${n(x1)} ${n(y1)}A${r} ${r} 0 ${part > 0.5 ? 1 : 0} 1 ${n(x2)} ${n(y2)}" fill="none" stroke="${color}" stroke-width="70" ${m("draw", group(k), 0.1 * k, 0.5)}/>`;
        at += part;
      });
      out += text(cx, cy, fit(s.center, 200, 60), s.center, "acc", 1, undefined, false, 0.3);
      const top = 430 - ((order.length - 1) * 80) / 2;
      order.forEach((index, k) => {
        out += `<rect x="760" y="${n(top + k * 80 - 14)}" width="28" height="28" rx="6" fill="${k === 0 ? C.red : k === 1 ? C.grey : C.line}" ${m("fade", group(k))}/>`
          + text(805, top + k * 80, fit(s.slices[index].label, 400, 34), s.slices[index].label, k === 0 ? "b7 start" : "b7 start muted", group(k));
      });
      return out + sourceLine(s.source, 0, 1100, 640);
    }
    case "steps": {
      const s = slots as z.infer<typeof slotSchemas.steps>;
      const gap = 80, w = Math.min(300, (1100 - gap * (s.steps.length - 1)) / s.steps.length), total = s.steps.length * w + (s.steps.length - 1) * gap, left = 640 - total / 2;
      return s.steps.map((label, i) => {
        const x = left + i * (w + gap), hot = i === s.pick;
        const arrow = i ? `<path class="i thin" d="M${n(x - gap + 14)} 440H${n(x - 16)}M${n(x - 30)} 426L${n(x - 16)} 440L${n(x - 30)} 454" ${m("draw", i, 0, 0.25)}/>` : "";
        return arrow + `<rect class="${hot ? "r" : "i"}" x="${n(x)}" y="375" width="${n(w)}" height="130" rx="18" ${m("fade", i, 0.1)}/>`
          + text(x + w / 2, 440, fit(label, w - 24, 40, 26), label, hot ? "acc" : "b8", i, undefined, false, 0.1);
      }).join("");
    }
    case "cycle": {
      const s = slots as z.infer<typeof slotSchemas.cycle>;
      const k = s.nodes.length, R = 200, cy = 440;
      const at = (i: number) => [640 + R * Math.sin((i / k) * 2 * Math.PI), cy - R * Math.cos((i / k) * 2 * Math.PI)];
      let out = "";
      s.nodes.forEach((label, i) => {
        const [x, y] = at(i), [fx, fy] = at(i + 0.3), [tx, ty] = at(i + 0.7), last = i === k - 1;
        // Arrowhead: two short strokes back from the arc end along its clockwise tangent.
        const a = ((i + 0.7) / k) * 2 * Math.PI, head = (turn: number) => `${n(tx - 22 * Math.cos(a + turn))} ${n(ty - 22 * Math.sin(a + turn))}`;
        out += pill(x, y, label, i, 38, last)
          + `<path class="${last ? "r" : "i"} bold" d="M${n(fx)} ${n(fy)}A${R} ${R} 0 0 1 ${n(tx)} ${n(ty)}M${head(0.5)}L${n(tx)} ${n(ty)}L${head(-0.5)}" ${m("draw", i, 0.25)}/>`;
      });
      return out + (s.center ? text(640, cy, fit(s.center, 200, 34), s.center, "muted b7", k - 1, undefined, false, 0.5) : "");
    }
    case "balance": {
      const s = slots as z.infer<typeof slotSchemas.balance>;
      const tilt = s.heavier === "left" ? -8 : s.heavier === "right" ? 8 : 0, rad = (tilt * Math.PI) / 180;
      const end = (side: number) => [640 + side * 300 * Math.cos(rad), 330 + side * 300 * Math.sin(rad)];
      const [lx, ly] = end(-1), [rx, ry] = end(1);
      const pan = (x: number, y: number, label: string, hot: boolean, g: number) =>
        `<path class="i thin" d="M${n(x)} ${n(y)}V${n(y + 90)}" ${m("draw", g, 0, 0.25)}/>`
        + `<path class="${hot ? "r" : "i"}" d="M${n(x - 110)} ${n(y + 90)}Q${n(x)} ${n(y + 150)} ${n(x + 110)} ${n(y + 90)}Z" ${m("draw", g, 0.1)}/>`
        + text(x, y + 190, fit(label, 260, 36), label, hot ? "acc" : "b8", g, undefined, false, 0.2);
      return `<polygon class="i" points="640,340 600,640 680,640" ${m("draw", 0)}/>`
        + `<path class="i bold" d="M${n(lx)} ${n(ly)}L${n(rx)} ${n(ry)}" ${m("draw", 0, 0.2)}/>`
        + pan(lx, ly, s.left, s.heavier === "left", 1) + pan(rx, ry, s.right, s.heavier === "right", 2);
    }
    case "funnel": {
      const s = slots as z.infer<typeof slotSchemas.funnel>;
      const gap = 640 / s.items.length;
      return s.items.map((item, i) => text(320 + gap * (i + 0.5), 250, fit(item, gap - 16, 34, 26), item, "b7", 0, undefined, false, 0.12 * i)).join("")
        + `<polygon class="i" points="360,300 920,300 700,500 580,500" ${m("draw", 0, 0.4, 0.4)}/>`
        + `<path class="r bold" d="M640 510V580M622 562L640 580L658 562" ${m("draw", 1)}/>`
        + text(640, 630, fit(s.result, 520, 40), s.result, "acc", 1, undefined, false, 0.2);
    }
    case "venn": {
      const s = slots as z.infer<typeof slotSchemas.venn>;
      return `<circle class="i" cx="530" cy="430" r="190" ${m("fade", 0)}/>` + text(420, 430, fit(s.a, 190, 36, 26), s.a, "b8", 0)
        + `<circle class="i" cx="750" cy="430" r="190" ${m("fade", 1)}/>` + text(860, 430, fit(s.b, 190, 36, 26), s.b, "b8", 1)
        + `<path class="r bold" d="M640 275A190 190 0 0 1 640 585A190 190 0 0 1 640 275Z" ${m("draw", 2, 0, 0.4)}/>`
        + text(640, 430, fit(s.both, 130, 34, 24), s.both, "acc", 2, undefined, false, 0.2);
    }
    case "ranking": {
      const s = slots as z.infer<typeof slotSchemas.ranking>;
      const block = (x: number, h: number, label: string, rank: number) =>
        `<rect class="${rank === 1 ? "r" : "i"}" x="${x - 110}" y="${620 - h}" width="220" height="${h}" rx="8" ${m("grow-y", rank - 1, 0, 0.35)}/>`
        + text(x, 620 - h / 2, 44, String(rank), rank === 1 ? "acc" : "b8 muted", rank - 1, undefined, false, 0.2)
        + text(x, 620 - h - 40, fit(label, 230, 34), label, rank === 1 ? "acc" : "b8", rank - 1, undefined, false, 0.3);
      return block(640, 260, s.first, 1) + block(400, 180, s.second, 2) + (s.third ? block(880, 120, s.third, 3) : "");
    }
    case "character_only": {
      const s = slots as z.infer<typeof slotSchemas.character_only>;
      return bust(s.character, sizes, 640, 960) + (s.label ? pill(1040, 200, s.label, 1, 32) : "");
    }
    case "split": {
      const s = slots as z.infer<typeof slotSchemas.split>;
      const side = (cx: number, title: string, note: string | undefined, g: number) =>
        text(cx, note ? 380 : 410, fit(title, 440, 52, 30), title, "b8", g) + (note ? text(cx, 450, fit(note, 440, 30), note, "muted", g, undefined, false, 0.1) : "");
      return side(340, s.left, s.leftNote, 0) + `<path class="i thin" d="M640 250V570" ${m("draw", 1, 0, 0.3)}/>` + side(940, s.right, s.rightNote, 1);
    }
    case "cards": {
      const s = slots as z.infer<typeof slotSchemas.cards>;
      const cols = s.items.length <= 4 ? s.items.length : 3, rows = Math.ceil(s.items.length / cols);
      const size = rows === 1 ? 240 : 200, gap = 26, left = 640 - (cols * size + (cols - 1) * gap) / 2, top = 430 - (rows * size + (rows - 1) * gap) / 2;
      return s.items.map((item, i) => {
        const x = left + (i % cols) * (size + gap), y = top + Math.floor(i / cols) * (size + gap);
        return `<rect x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="24" fill="${C.pale}" stroke="${C.line}" stroke-width="3" ${m("fade", i)}/>`
          + text(x + size / 2, y + size / 2, fit(item, size - 40, 40, 26), item, "b8", i);
      }).join("");
    }
    case "phone": {
      const s = slots as z.infer<typeof slotSchemas.phone>;
      const side = s.side || s.sideAccent, px = side ? 330 : 490;
      return `<rect x="${px}" y="160" width="300" height="560" rx="48" fill="${C.paper}" stroke="${C.ink}" stroke-width="10" ${m("fade", 0)}/>`
        + `<rect x="${px + 12}" y="172" width="276" height="200" rx="36" fill="${C.pale}" ${m("fade", 0)}/>`
        + `<rect x="${px + 110}" y="182" width="80" height="14" rx="7" fill="${C.ink}" ${m("fade", 0)}/>`
        + `<path d="M${px + 128} 240L${px + 128} 310L${px + 184} 275Z" fill="${C.red}" ${m("fade", 0)}/>`
        + wrap(s.screen, 7).map((line, i) => text(px + 36, 420 + i * 44, fit(line, 230, 34, 24), line, "b8 start", 0, undefined, false, 0.1)).join("")
        + (s.sub ? text(px + 36, 520, 22, s.sub, "muted start", 0, undefined, false, 0.15) : "")
        + (s.side ? text(720, 380, fit(s.side, 460, 48, 30), s.side, "b8 start", 1) : "")
        + (s.sideAccent ? text(720, 450, fit(s.sideAccent, 460, 48, 30), s.sideAccent, "acc start", 1, undefined, false, 0.3) : "");
    }
    case "caption_only":
      return `<g ${m("fade", 0)}/>`;
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
export const SCENE_TEMPLATE_GUIDE = `question: 시청자 질문 카드(이름·숫자 없음). 질문으로 이야기를 열 때. {"question": "30자 이내 질문", "accent"?: "질문 속 빨간 단어"}
character_only: 고민·문제·감정을 캐릭터 상반신 하나로 가운데 크게(자막이 설명). {"character": "목록의 id", "label"?: "검은 알약 한마디 16자"}
cards: 같은 맥락의 예시를 카드 격자로 한 칸씩 채움(2~6개). {"items": ["8자", ...]}
phone: 휴대폰 화면 속 모습(SNS·유튜브에서 본 남의 성공, 비교). {"screen": "화면 속 제목 14자", "sub"?: "14자", "side"?: "옆 문장 12자", "sideAccent"?: "옆 빨간 문장 14자"}
split: 서로 대조되는 두 가지를 좌/우로 나란히(우열 없이). {"left": "12자", "leftNote"?: "16자", "right": "12자", "rightNote"?: "16자"}
caption_only: 화면을 비우고 자막만(자기소개·자격 소개·인사처럼 보여줄 것이 없는 말). {}
statement: 결론을 못 박는 큰 문장. 두 줄이면 둘째 줄 전체가 빨강+밑줄. {"lines": ["16자 이내", "둘째 줄(핵심)"], "accent"?: "한 줄일 때 빨간 밑줄 단어"}
character_labels: 캐릭터 상반신 + 옆에 검은 알약 라벨 1~2개(짧은 요약·공식, 예 "책 < 실패"). {"character": "목록의 id", "labels": ["14자 이내", "선택"], "accent"?: "빨간 알약으로 만들 라벨 속 단어"}
compare: 흔한 생각 vs 진짜 답. {"a": "10자", "aNote"?: "12자", "b": "10자", "bNote"?: "12자", "pick": "a|b"}
formula: 원인을 A + B = C 한 줄로. {"a": "8자", "b": "8자", "result": "8자"}
list: 메모 앱 창 속 체크리스트. 조언·목록을 하나씩 추가하고 하나를 짚음. {"title"?: "메모 제목 20자", "items": ["16자 이내", 2~5개], "pick"?: 0부터 시작하는 번호}
bar_chart: 수치 비교(막대 2~4개). {"bars": [{"label": "8자", "value": 숫자}], "unit"?: "4자", "highlight": 번호, "source"?: "출처"}
capture: 기사·논문·자료의 핵심 문장 강조. {"heading": "자료 제목 22자", "lines": ["자료 속 문장 24자", "선택"], "source"?: "출처"}
big_number: 수치 하나를 크게. {"value": "10명 중 7명 같은 10자", "caption": "의미 24자", "source"?: "출처"}
quote: 연구·책의 인용. {"lines": ["16자", "선택"], "accent"?: "빨간 단어", "attribution": "누가, 언제 24자"}
line_chart: 시간에 따른 변화(점 3~8개). {"points": [{"label"?: "6자", "value": 숫자}], "highlightFrom": 빨간 구간 시작 번호, "callout": "핵심 지점 10자", "source"?: "출처"}
donut: 비율·구성(조각 2~3개). {"slices": [{"label": "12자", "value": 숫자}], "highlight": 번호, "center": "가운데 6자", "source"?: "출처"}
steps: 단계·흐름·인과가 차례로 이어짐(2~4단계, 화살표). {"steps": ["8자", ...], "pick"?: 빨간 단계 번호}
cycle: 끝나면 다시 처음으로 돌아가는 반복·악순환(3~4개, 마지막이 빨강). {"nodes": ["6자", ...], "center"?: "가운데 8자"}
balance: 두 가지의 무게·비중을 비교하는 저울. {"left": "8자", "right": "8자", "heavier": "left|right|even"}
funnel: 많은 것이 걸러져 하나로 좁혀짐. {"items": ["6자", 2~4개], "result": "걸러진 결과 10자"}
venn: 두 가지가 겹치거나 섞임. {"a": "8자", "b": "8자", "both": "겹친 부분 8자"}
ranking: 순서·우선순위(1등이 빨강). {"first": "8자", "second": "8자", "third"?: "8자"}

[cues: 도식이 나타나는 순간]
각 틀은 부분이 차례로 나타납니다. cues에는 각 부분이 나타나야 할 순간의 원고 표현을 그 비트의 멘트 안에서 그대로 복사해 순서대로 적습니다. 첫 cue는 보통 spokenAnchor와 같습니다. 부분 수: cards 칸 수, phone 1(옆 문장이 있으면 2), character_only 1(label이 있으면 2), caption_only 1, split 2(왼쪽, 오른쪽), question 1, statement 줄 수, character_labels 1+라벨 수, list 항목 수, bar_chart 막대 수, steps 단계 수, cycle 노드 수, ranking 1등·2등·(3등), compare(A, B, 강조) 3, formula(A, B, 결과) 3, balance(받침, 왼쪽, 오른쪽) 3, venn(A, B, 겹침) 3, 나머지 2(바탕, 강조).`;
