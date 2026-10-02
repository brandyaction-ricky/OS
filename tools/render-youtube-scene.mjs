/**
 * Render a private narrated video from a v7 brief: the scene model's per-beat SVG,
 * a verified word timeline, the final audio, and the private character catalog.
 * Every beat passes the shared SVG boundary and a geometry check in Chromium
 * before any frame is encoded. No provider calls or uploads occur here.
 *
 * node tools/render-youtube-scene.mjs --brief b.json --audio a.m4a --catalog catalog.json --output out.mp4
 *   [--allow-provisional-study] [--check-only] [--fps 24]
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { validateSceneSvg, YOUTUBE_SCENE_PALETTE as C, YOUTUBE_SCENE_SAFE_AREA as SAFE } from "../lib/youtube-scene-svg.ts";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "../lib/youtube-visual-template.ts";

const VERSION = YOUTUBE_VISUAL_TEMPLATE_VERSION;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };
// Pretendard (captions, sources), Gaegu (hand-written labels) and Jua (titles, key sentences, numbers), all OFL-1.1.
const FONTS = [
  ["Pretendard", 600, "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-SemiBold.woff2", "c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0", "woff2"],
  ["Pretendard", 800, "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-ExtraBold.woff2", "dd7c1e156f508eb962acc7a33a7a1896d1e0b71e11156fad96e731689ceb6dc3", "woff2"],
  ["Gaegu", 700, "https://cdn.jsdelivr.net/gh/google/fonts@16680f8688ffcd467d2eb2146a9ce0343404581d/ofl/gaegu/Gaegu-Bold.ttf", "cc38a4af9506a45254d1ce07c589ec473d9e5f0be319e5a77b17c214903f8c1c", "truetype"],
  ["Jua", 400, "https://cdn.jsdelivr.net/gh/google/fonts@16680f8688ffcd467d2eb2146a9ce0343404581d/ofl/jua/Jua-Regular.ttf", "3080d35028a655cf20b6dbd0714fa8170605b933e4a211c1ae2e4f442039faf6", "truetype"],
];

export async function fontFaces() {
  const faces = [];
  for (const [family, weight, url, digest, format] of FONTS) {
    const cached = path.join(os.tmpdir(), `brandyaction-${digest}.font`);
    let bytes = existsSync(cached) ? readFileSync(cached) : Buffer.from(await (await fetch(url)).arrayBuffer());
    if (sha256(bytes) !== digest) fail(`Font checksum changed: ${url}`);
    writeFileSync(cached, bytes);
    faces.push(`@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/${format === "woff2" ? "woff2" : "ttf"};base64,${bytes.toString("base64")}) format("${format}")}`);
  }
  return faces.join("");
}

export function checkBrief(brief, audioBytes, audioSeconds, catalog, allowProvisional) {
  if (brief.timingSource !== "verified_word" && !(allowProvisional && brief.timingSource === "provisional_pause"))
    fail("Only verified word timing may render unless a provisional design study is explicitly requested");
  const timeline = brief.timeline ?? {};
  if (timeline.templateVersion !== VERSION || sha256(audioBytes) !== timeline.audioSha256) fail("Final audio checksum or visual template version changed");
  const duration = Number(timeline.audioDurationSeconds);
  if (!(duration > 0 && duration <= 14_400) || Math.abs(audioSeconds - duration) > 0.25) fail("Final audio duration differs from the timeline");
  if (catalog.version !== "brandyaction-character-catalog-v2") fail("Character catalog version changed");
  const ids = new Set(catalog.assets.filter((asset) => asset.usable).map((asset) => asset.id));
  const scenes = brief.scenePlan?.scenes ?? [];
  if (!timeline.beats?.length) fail("No timed beats");
  let priorEnd = 0;
  const used = new Set();
  for (const [n, beat] of timeline.beats.entries()) {
    const start = Number(beat.visualStartSeconds), end = Number(beat.endSeconds), typo = beat.typographyStartSeconds;
    if (start < priorEnd - 0.02 || end <= start || end > duration + 0.05) fail(`Beat ${n + 1}: invalid order or duration`);
    priorEnd = end;
    const planned = scenes[beat.segmentIndex]?.visualBeats?.[beat.beatIndex];
    if (!planned) fail(`Beat ${n + 1}: scene plan mismatch`);
    // Alignment may leave a headline out, but never edits the drawing or the headline it keeps.
    const titleDropped = !beat.displayText && !beat.accentText && !beat.typographyAnchor;
    for (const field of ["spokenAnchor", "svg", ...(titleDropped ? [] : ["displayText", "accentText", "typographyAnchor"])])
      if (planned[field] !== beat[field]) fail(`Beat ${n + 1}: scene plan changed after word alignment`);
    if ((typo === null) !== !beat.displayText || (typo !== null && (typo <= start || typo >= end)))
      fail(`Beat ${n + 1}: typography must follow the drawing and end inside the beat`);
    const svg = validateSceneSvg(beat.svg, ids);
    if (!svg.ok) fail(`Beat ${n + 1}: ${svg.error}`);
    svg.summary.characters.forEach((id) => used.add(id));
  }
  return { duration, used };
}

/**
 * Effect sounds are synthesized here, so no audio files or licences are involved. Soft pops (chosen by the owner on
 * 2026-09-30): a low round thump on a scene change, a small pop when a part is drawn, a soft note when a character
 * enters, a faint tick on a red accent. Returns a 16-bit mono WAV with each sound placed at its time.
 */
export function effectTrack(events, duration, rate = 48_000) {
  const out = new Float32Array(Math.ceil((duration + 1) * rate));
  // mulberry32: deterministic, so the same video renders the same sound.
  let seed = 7;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32; };
  const tone = (f, decay, amp, attack = 0.003) => (t) => (t > 6 / decay ? null : Math.sin(2 * Math.PI * f * t) * Math.min(1, t / attack) * Math.exp(-t * decay) * amp);
  const sound = { transition: (v) => tone(140 * v, 22, 0.28, 0.006), build: (v) => tone(720 * v, 70, 0.11), appear: (v) => tone(660 * v, 10, 0.08), accent: (v) => tone(1300 * v, 120, 0.05) };
  let lastTransition = -Infinity;
  for (const { t, kind, dur } of events) {
    // Camera move (Logan, 2026-10-02): a low whoosh (≈400 Hz and below) as long as the move, a little louder when quick.
    if (kind === "move") {
      const len = Math.max(0.3, dur), gain = 0.5 * Math.min(1.4, 0.9 / len);
      let a = 0, b = 0, c = 0;
      for (let i = Math.round(t * rate), n = 0; n < len * rate && i < out.length; i++, n++) {
        a += 0.05 * ((rnd() * 2 - 1) - a); b += 0.05 * (a - b); c += 0.05 * (b - c);
        out[i] += c * Math.sin(Math.PI * n / (len * rate)) ** 2 * gain * 1.6;
      }
      continue;
    }
    // Scenes change every few seconds; a scene-change sound plays at most once every 4 s.
    if (kind === "transition") { if (t - lastTransition < 4) continue; lastTransition = t; }
    // Slightly different pitch and level each time, so repeats do not sound mechanical.
    const f = sound[kind](0.94 + rnd() * 0.12), gain = 0.8 + rnd() * 0.2;
    for (let i = Math.round(t * rate), n = 0; i < out.length; i++, n++) { const v = f(n / rate); if (v === null) break; out[i] += v * gain; }
  }
  const wav = Buffer.alloc(44 + out.length * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + out.length * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(out.length * 2, 40);
  out.forEach((v, i) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32_767), 44 + i * 2));
  return wav;
}

/** Output frame, and the poster the camera moves over (designed at 2× so the closing full view fills the frame). */
const VW = 1920, VH = 1080, POSTER = { w: 3840, h: 2160 };
/** YouTube player chrome covers the top 6% and bottom 12%; captions sit just above the bottom band. */
const SAFE_TOP = 65, SAFE_BOTTOM = 130, CAPTION_SPACE = 120;
/** Seconds of opening (poster drawn empty) before the narration, and of closing full view after it. */
const OPEN = 1.8, CLOSE = 5;
// The camera holds every shot at least MIN_SHOT seconds; a move between shots takes MOVE seconds or a little more.
const MIN_SHOT = 4, MOVE = 1;
/** Visual motion is stepped at 15 fps (drawn on twos); audio and captions stay continuous. */
const STEP_FPS = 15;
/** Each scene is shown through this window of its 1280×720 frame (the band its content is centred in). */
const CELL_VIEW = { x: 0, y: 40, w: 1280, h: 600 };
/** Logan's design system (2026-10-02): charcoal text/lines, navy for section titles and bars, red for one key word. */
const INK = "#2B2B2B", NAVY = "#2F3E6B", RED = "#D93A2B", GREY = "#8C8578", PAPER = "#F4F1EA";
/** Template text at or above this size is a key sentence or number (Jua); smaller text is a label (Gaegu, enlarged). */
const JUA_FROM = 56, GAEGU_SCALE = 1.15;

/**
 * Lay the poster out: title band, then one framed section per row group, each holding its paragraphs as panels
 * (one cell per scene, side by side). Panel size grows with importance. The cell size is the largest that fits.
 */
export function posterLayout(poster, cellCounts, size = POSTER) {
  const M = 100, TITLE = 240, grow = [1, 1.2, 1.45], aspect = CELL_VIEW.w / CELL_VIEW.h;
  const attempt = (cw) => {
    // Spacing follows the cell size, so a poster with many scenes does not spend its area on margins.
    const GAP = Math.max(60, 0.25 * cw), PAD = Math.max(20, 0.1 * cw), HEAD = Math.max(70, 0.32 * cw);
    const PANEL_GAP = Math.max(16, 0.14 * cw), CELL_GAP = Math.max(6, 0.05 * cw), PANEL_PAD = Math.max(12, 0.12 * cw), lineW = size.w - 2 * M - 2 * PAD;
    const sections = [];
    let y = M + TITLE, fits = true;
    poster.sections.forEach((section, s) => {
      const panels = section.panels.map((panel, p) => {
        const n = Math.max(1, cellCounts.get(panel.segmentIndex) ?? 1), f = grow[(panel.importance ?? 2) - 1] ?? 1;
        const w = cw * f, h = w / aspect, perRow = Math.max(1, Math.min(n, Math.floor((lineW - 2 * PANEL_PAD + CELL_GAP) / (w + CELL_GAP))));
        const rows = Math.ceil(n / perRow);
        if (w + 2 * PANEL_PAD > lineW) fits = false;
        return { ...panel, number: `${s + 1}${String.fromCharCode(97 + p)}`, n, perRow, cw: w, ch: h,
          w: perRow * w + (perRow - 1) * CELL_GAP + 2 * PANEL_PAD, h: rows * h + (rows - 1) * CELL_GAP + 2 * PANEL_PAD };
      });
      const lines = [];
      for (const panel of panels) {
        const line = lines.at(-1);
        if (line && line.w + PANEL_GAP + panel.w <= lineW) { line.items.push(panel); line.w += PANEL_GAP + panel.w; line.h = Math.max(line.h, panel.h); }
        else lines.push({ items: [panel], w: panel.w, h: panel.h });
      }
      const top = y, inner = lines.reduce((sum, line) => sum + line.h, 0) + (lines.length - 1) * PANEL_GAP;
      let ly = top + HEAD + PAD;
      for (const line of lines) {
        let x = M + PAD + (lineW - line.w) / 2;
        for (const panel of line.items) {
          panel.frame = { x, y: ly + (line.h - panel.h) / 2, w: panel.w, h: panel.h };
          panel.cells = Array.from({ length: panel.n }, (_, i) => ({ x: x + PANEL_PAD + (i % panel.perRow) * (panel.cw + CELL_GAP),
            y: panel.frame.y + PANEL_PAD + Math.floor(i / panel.perRow) * (panel.ch + CELL_GAP), w: panel.cw, h: panel.ch }));
          x += panel.w + PANEL_GAP;
        }
        ly += line.h + PANEL_GAP;
      }
      const h = HEAD + 2 * PAD + inner;
      sections.push({ label: section.label, index: s + 1, frame: { x: M, y: top, w: size.w - 2 * M, h }, head: HEAD, panels });
      y += h + GAP;
    });
    return { fits: fits && y - GAP + M <= size.h, sections };
  };
  let lo = 60, hi = 1400;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (attempt(mid).fits) lo = mid; else hi = mid; }
  const { sections } = attempt(lo);
  const arrows = sections.slice(1).map((next, i) => ({ x: M + 70, y1: sections[i].frame.y + sections[i].frame.h + 10, y2: next.frame.y - 10 }));
  return { title: { x: size.w / 2, y: M + TITLE / 2 - 10 }, sections, arrows, cellWidth: lo };
}

/** Fritsch–Carlson monotone cubic through (xs, ys): no overshoot, and flat where neighbouring keys are equal. */
export function monotoneCubic(xs, ys) {
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-9));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (xs[i + 1] - xs[i - 1])) / ((2 * xs[i + 1] - xs[i] - xs[i - 1]) / d[i - 1] + (xs[i + 1] + xs[i] - 2 * xs[i - 1]) / d[i]);
  if (n > 1) { m[0] = d[0]; m[n - 1] = d[n - 2]; if (n > 2) { m[0] = 0; m[n - 1] = 0; } }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** YouTube description chapters: "0:00 01 섹션" lines. YouTube needs at least three, each 10 s or longer. */
export function youtubeChapters(sections) {
  const stamp = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const lines = sections.map((s, i) => `${stamp(i ? s.start : 0)} ${String(i + 1).padStart(2, "0")} ${s.label}`);
  const ok = sections.length >= 3 && sections.every((s, i) => (sections[i + 1]?.start ?? s.end) - (i ? s.start : 0) >= 10);
  return { text: lines.join("\n"), ok };
}

/** A hand-drawn line: a gently bent stroke drawn twice with small offsets, like the same line traced twice. */
function roughLine(x1, y1, x2, y2, rnd, rough = 1.5) {
  const pass = () => {
    const j = () => (rnd() - 0.5) * 4 * rough, len = Math.hypot(x2 - x1, y2 - y1), bend = Math.min(18, len * 0.012) * rough;
    const mx = (x1 + x2) / 2 + (rnd() - 0.5) * bend, my = (y1 + y2) / 2 + (rnd() - 0.5) * bend;
    return `M${(x1 + j()).toFixed(1)} ${(y1 + j()).toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${(x2 + j()).toFixed(1)} ${(y2 + j()).toFixed(1)}`;
  };
  return pass() + pass();
}
const rectPath = (b) => `M${b.x} ${b.y}H${b.x + b.w}V${b.y + b.h}H${b.x}Z`;
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The poster's own drawing: title with a red highlighter, section frames and titles, plain rectangular panel frames, arrows. */
/**
 * Group scenes into camera shots (lists of scene indexes). Short scenes of the same panel share a shot (their cells
 * are side by side and framed together) until the shot lasts MIN_SHOT plus the move out of it; a panel's tail
 * shorter than MIN_SHOT - MOVE joins the panel's shot before it. A caption-only scene stays in the shot before it.
 * Shots never span two panels: a short shot is still held MIN_SHOT and the next shot's drawing waits for the camera
 * (see buildCamera), which keeps cells large at the cost of a drawing up to about 2 s behind the voice.
 */
export function cameraShots(starts, drawn, panels, end) {
  const shots = [], long = (shot, until) => until - starts[shot[0]] >= MIN_SHOT + MOVE;
  starts.forEach((t, i) => {
    const cur = shots.at(-1), prev = shots.at(-2);
    if (cur && (!drawn[i] || (panels[i] === panels[cur[0]] && !long(cur, t)))) return cur.push(i);
    if (cur && prev && t - starts[cur[0]] < MIN_SHOT - MOVE && panels[cur[0]] === panels[prev[0]]) prev.push(...shots.pop());
    shots.push([i]);
  });
  const cur = shots.at(-1), prev = shots.at(-2);
  if (prev && panels[cur[0]] === panels[prev[0]] && end - starts[cur[0]] < MIN_SHOT) prev.push(...shots.pop());
  return shots;
}

/** A section title "01 label": font size and approximate width on the poster. */
export function sectionLabel(s) {
  const fs = Math.max(60, s.head * 0.6), label = `${String(s.index).padStart(2, "0")} ${s.label}`;
  return { fs, label, lw: [...label].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 1 : 0.55), 0) * fs };
}

/** A scene with nothing to draw (caption only): it gets no cell, and the camera shows its section meanwhile. */
export const blankBeat = (beat) => !/<(?!g[\s/>])[a-z]/i.test(beat.svg ?? "");

export function posterDecor(layout, title) {
  let seed = 11;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32; };
  // Lines keep a constant on-screen width however far the camera zooms: --zw is 1/zoom, set each frame
  // (the red title marker is a band and scales with the poster).
  const draw = (d, stroke, width, t, dur, extra = "", scales = false) => `<path d="${d}" stroke="${stroke}" ${scales ? `stroke-width="${width}"` : `style="stroke-width:calc(var(--zw) * ${width})"`} fill="none" stroke-linecap="round" pathLength="1" data-k="draw" data-t="${t}" data-d="${dur}" ${extra}/>`;
  const out = [];
  const tw = Math.min(2600, [...title].reduce((s, ch) => s + (/[가-힣]/.test(ch) ? 1 : 0.55), 0) * 116);
  if (title) {
    out.push(draw(roughLine(layout.title.x - tw / 2, layout.title.y + 40, layout.title.x + tw / 2, layout.title.y + 28, rnd, 2), RED, 42, 0.2, 0.35, 'stroke-opacity=".55"', true));
    out.push(`<text x="${layout.title.x}" y="${layout.title.y}" class="jua" font-size="116" fill="${INK}" text-anchor="middle" dominant-baseline="middle" data-k="fade" data-t="0.05" data-d="0.3">${esc(title)}</text>`);
  }
  layout.sections.forEach((s, i) => {
    const t = 0.25 + i * 0.08;
    out.push(draw(rectPath(s.frame), GREY, 2.5, t, 0.45, 'stroke-linejoin="miter"'));
    // Section title: Gaegu, sized to its header band (at least 60 px on the poster), with a navy underline.
    // Scene stylesheets apply document-wide (text-anchor: middle), so the title sets its own start anchor inline.
    const { fs, label, lw } = sectionLabel(s);
    out.push(`<text x="${s.frame.x + fs * 0.6}" y="${s.frame.y + s.head * 0.55}" class="gaegu" font-size="${fs.toFixed(0)}" fill="${NAVY}" style="text-anchor:start" dominant-baseline="middle" data-k="fade" data-t="${t + 0.2}" data-d="0.3">${esc(label)}</text>`);
    out.push(draw(roughLine(s.frame.x + fs * 0.55, s.frame.y + s.head * 0.55 + fs * 0.62, s.frame.x + fs * 0.7 + lw, s.frame.y + s.head * 0.55 + fs * 0.56, rnd, 1.2), NAVY, 3.5, t + 0.35, 0.3));
    s.panels.forEach((p, j) => {
      out.push(draw(rectPath(p.frame), INK, 2.5, t + 0.1 + j * 0.03, 0.35, 'stroke-linejoin="miter"'));
    });
  });
  layout.arrows.forEach((a, i) => {
    const head = Math.min(26, (a.y2 - a.y1) * 0.4);
    out.push(draw(roughLine(a.x, a.y1, a.x + 4, a.y2, rnd, 1) + `M${a.x - head * 0.8} ${a.y2 - head}L${a.x + 4} ${a.y2}L${a.x + head * 0.9} ${a.y2 - head * 0.95}`, INK, 3, 0.6 + i * 0.08, 0.3));
  });
  return out.join("");
}

export function pageHtml(beats, characters, faces, captions, layout, decor, duration) {
  const style = `.i{stroke:${INK};stroke-width:4;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .r{stroke:${RED};stroke-width:4;fill:none;stroke-linecap:round;stroke-linejoin:round} .thin{stroke-width:3} .bold{stroke-width:6} .p{fill:url(#hatch)}
    text{font-family:"Gaegu";font-weight:700;fill:${INK};text-anchor:middle;dominant-baseline:middle;stroke:none;text-rendering:geometricPrecision}
    .lab{font-size:30px} .sm{font-size:26px;fill:${GREY};font-family:"Pretendard";font-weight:600} .acc{fill:${RED}} .muted{fill:${GREY}}
    .start{text-anchor:start} .end{text-anchor:end} .inv{fill:${INK}} .jua{font-family:"Jua";font-weight:400}`;
  // Cells: each scene sits in its panel cell, seen through the band of its frame that holds its content.
  const cells = new Map();
  layout.sections.forEach((s) => s.panels.forEach((p) => cells.set(p.segmentIndex, p)));
  const seen = new Map();
  const placed = [];
  beats.forEach((beat) => {
    if (blankBeat(beat)) {
      const section = placed.at(-1)?.section ?? 0;
      return placed.push({ ...beat, cell: null, panel: "", panelFrame: layout.sections[section].frame, section });
    }
    const panel = cells.get(beat.segmentIndex), n = seen.get(beat.segmentIndex) ?? 0;
    seen.set(beat.segmentIndex, n + 1);
    const cell = panel?.cells[Math.min(n, panel.cells.length - 1)] ?? { x: 0, y: 0, w: 1280, h: 600 };
    placed.push({ ...beat, cell, panel: panel?.number ?? "", panelFrame: panel?.frame ?? cell, section: Math.max(0, layout.sections.findIndex((s) => s.panels.includes(panel))) });
  });
  const grain = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .35 0 0 0 0 .3 0 0 0 0 .25 0 0 0 .9 0'/></filter><rect width='400' height='400' filter='url(%23n)'/></svg>`)}")`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
  html,body{margin:0;width:${VW}px;height:${VH}px;background:${PAPER};overflow:hidden}
  #poster{position:absolute;left:0;top:0;width:${POSTER.w}px;height:${POSTER.h}px;transform-origin:0 0;background:${PAPER}}
  #poster::before{content:"";position:absolute;inset:0;background-image:${grain};opacity:.07;pointer-events:none}
  #poster>svg{position:absolute;overflow:visible}
  #decor .jua{font-family:"Jua"} #decor .gaegu{font-family:"Gaegu";font-weight:700}
  /* Spoken caption above YouTube's bottom controls: one line (the timeline keeps it to 16 characters) on a white box so
     poster lines never run through it; charcoal only, one phrase in bold. */
  #cap{position:absolute;left:0;right:0;bottom:${SAFE_BOTTOM + 14}px;text-align:center;font:500 46px/1.32 "Pretendard";color:${INK};letter-spacing:-.5px;white-space:nowrap;z-index:2}
  #cap span{display:inline-block;background:#FFFFFF;padding:6px 22px 8px;border-radius:4px} #cap b{font-weight:800}</style></head><body><div id="cap"></div>
  <svg width="0" height="0" style="position:absolute"><defs>${[1, 2, 3].map((n) => `<filter id="pencil${n}" filterUnits="userSpaceOnUse" x="-1000" y="-1000" width="6000" height="4500"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${n * 7}"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter>`).join("")}
    <pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="${PAPER}"/><line x1="0" y1="0" x2="0" y2="14" stroke="${NAVY}" stroke-width="5" stroke-opacity=".55"/></pattern></defs></svg>
  <div id="poster"><svg id="decor" width="${POSTER.w}" height="${POSTER.h}" viewBox="0 0 ${POSTER.w} ${POSTER.h}" style="left:0;top:0">${decor}</svg>
  ${placed.map((beat, i) => !beat.cell ? "" : `<svg id="b${i}" viewBox="${CELL_VIEW.x} ${CELL_VIEW.y} ${CELL_VIEW.w} ${CELL_VIEW.h}" width="${beat.cell.w.toFixed(1)}" height="${beat.cell.h.toFixed(1)}" style="left:${beat.cell.x.toFixed(1)}px;top:${beat.cell.y.toFixed(1)}px;visibility:hidden"><style>${style}</style>
    <defs><filter id="line${i}"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 1 1 1"/><feFuncG type="discrete" tableValues="0 1 1 1"/><feFuncB type="discrete" tableValues="0 1 1 1"/></feComponentTransfer></filter></defs>
    ${beat.svg.replace(/<image data-character="([a-z0-9_-]+)"/g, (_, id) => `<image href="${characters.get(id)}" preserveAspectRatio="xMidYMid meet" data-character="${id}"`)}</svg>`).join("")}</div>
  <script>
  const OPEN = ${OPEN}, CLOSE = ${CLOSE}, STEP = ${STEP_FPS}, total = ${Number(duration) || 0};
  const beats = ${JSON.stringify(placed.map((beat) => ({ ...beat, svg: undefined })))};
  const captions = ${JSON.stringify(captions)};
  const layout = ${JSON.stringify({ sections: layout.sections.map((s) => ({ index: s.index, frame: s.frame, head: s.head, label: s.label, labelW: sectionLabel(s).fs + sectionLabel(s).lw })) })};
  const monotoneCubic = ${monotoneCubic.toString()};
  const ease = v => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
  const poster = document.getElementById('poster'), svgs = beats.map((_, i) => document.getElementById('b' + i));
  document.querySelectorAll('[data-k="draw"]').forEach(el => { el.setAttribute('pathLength', 1); el.style.strokeDasharray = 1; el.style.strokeDashoffset = 1; });
  document.querySelectorAll('image[data-k="character"]').forEach((img, n) => {
    const svg = img.ownerSVGElement, i = svg.id.slice(1), ns = 'http://www.w3.org/2000/svg';
    const clip = document.createElementNS(ns, 'clipPath'); clip.id = 'sweep' + i + '-' + n;
    const rect = document.createElementNS(ns, 'rect');
    ['x', 'y', 'height'].forEach(a => rect.setAttribute(a, img.getAttribute(a)));
    rect.setAttribute('width', 0); clip.appendChild(rect); svg.querySelector('defs').appendChild(clip);
    const line = img.cloneNode(); line.removeAttribute('data-k');
    line.setAttribute('filter', 'url(#line' + i + ')'); line.setAttribute('clip-path', 'url(#' + clip.id + ')');
    img.parentNode.insertBefore(line, img); img._sweep = rect; img._line = line;
  });
  // After fonts load: key sentences and numbers in Jua, labels in Gaegu, sources in Pretendard; black badges become
  // outlined paper labels; underlines and rings are measured; each scene is centred in its frame.
  window.layoutBeats = () => {
    const ns = 'http://www.w3.org/2000/svg';
    document.querySelectorAll('#poster > svg[id^="b"] text').forEach(el => {
      const size = +el.getAttribute('font-size') || 30;
      if (el.classList.contains('sm')) return;
      if (size >= ${JUA_FROM}) el.classList.add('jua'); else el.setAttribute('font-size', size * ${GAEGU_SCALE});
    });
    document.querySelectorAll('#poster > svg[id^="b"] rect').forEach(el => {
      const fill = (el.getAttribute('fill') || '').toUpperCase();
      if (fill === '${C.ink}'.toUpperCase() || fill === '${C.red}'.toUpperCase()) {
        const red = fill === '${C.red}'.toUpperCase();
        el.setAttribute('fill', '${PAPER}'); el.setAttribute('stroke', red ? '${RED}' : '${INK}'); el.setAttribute('stroke-width', 4);
        let t = el.nextElementSibling; if (t && t.tagName === 'text' && t.classList.contains('inv')) t.style.fill = red ? '${RED}' : '${INK}';
      } else if (fill === '${C.pale}'.toUpperCase()) el.setAttribute('fill', 'url(#hatch)');
    });
    const add = (tag, attrs, after) => { const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); after.after(el);
      if (attrs['data-k'] === 'draw') { el.setAttribute('pathLength', 1); el.style.strokeDasharray = 1; el.style.strokeDashoffset = 1; } return el; };
    svgs.filter(Boolean).forEach(svg => {
      svg.querySelectorAll('.ul').forEach(el => { const b = el.getBBox(), host = el.closest('text'), y = b.y + b.height + 6, w = b.width;
        add('path', { class: 'r bold', d: 'M' + b.x + ' ' + (y + 4) + 'C' + (b.x + w * .25) + ' ' + (y - 8) + ' ' + (b.x + w * .55) + ' ' + (y + 10) + ' ' + (b.x + w) + ' ' + (y - 4), 'data-k': 'draw', 'data-g': host.dataset.g || 0, 'data-s': (+host.dataset.s || 0) + .45, 'data-d': .35 }, host); });
      svg.querySelectorAll('text.ring').forEach(el => { const b = el.getBBox();
        add('ellipse', { class: 'r', cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2 + 34, ry: b.height / 2 + 16, 'data-k': 'draw', 'data-g': el.dataset.g || 0, 'data-s': (+el.dataset.s || 0) + .4, 'data-d': .4 }, el); });
      const group = document.createElementNS(ns, 'g');
      [...svg.childNodes].filter(n => !['style', 'defs'].includes(n.nodeName)).forEach(n => group.appendChild(n));
      svg.appendChild(group);
      const b = group.getBBox();
      if (b.width && b.height) {
        const font = Math.max(1, ...[...svg.querySelectorAll('text')].map(t => +t.getAttribute('font-size') || 30));
        // A fixed layout (two columns centred in each half) keeps its size and only moves vertically.
        const fixed = svg.querySelector('.fixed'), k = fixed ? 1 : Math.min(1.4, 110 / font, 1140 / b.width, 520 / b.height);
        group.setAttribute('transform', 'translate(' + (fixed ? 0 : 640 - (b.x + b.width / 2) * k).toFixed(1) + ' ' + (340 - (b.y + b.height / 2) * k).toFixed(1) + ') scale(' + k.toFixed(3) + ')');
      }
      svg.querySelectorAll('.i,.r,rect,circle,ellipse,line,path,polyline').forEach(el => el.classList.add('pen'));
    });
    buildCamera();
  };
  // Camera: the full poster while it is drawn, one move into the first shot, then a direct pan/zoom from shot to shot
  // (no pull-back in between), each shot held at least ${MIN_SHOT} s, and a pull-back to the full poster at the end.
  // Keys are joined by a monotone cubic so a move never overshoots or stalls; zoom is interpolated in log space.
  const frameH = ${VH - SAFE_TOP - SAFE_BOTTOM - CAPTION_SPACE}, frameMid = ${SAFE_TOP} + frameH / 2;
  // A margin of 6% of the framed box on each side, so a zoomed-in cell still fills the frame.
  // The camera never shows beyond the paper: at least the whole-poster zoom, and kept inside its edges.
  const view = (b, pad = 0.06) => {
    const k = Math.max(${VW / POSTER.w}, Math.min((${VW} - 60) / (b.w * (1 + pad * 2)), (frameH - 10) / (b.h * (1 + pad * 2))));
    const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
    return { x: clamp(b.x + b.w / 2, ${VW / 2} / k, ${POSTER.w} - ${VW / 2} / k), y: clamp(b.y + b.h / 2, frameMid / k, ${POSTER.h} - (${VH} - frameMid) / k), k };
  };
  const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
  const overview = { x: ${POSTER.w / 2}, y: ${POSTER.h / 2}, k: ${VW / POSTER.w} };
  let cam = null, moves = [];
  const MIN_SHOT = ${MIN_SHOT}, MOVE = ${MOVE}, cameraShots = ${cameraShots.toString()};
  function buildCamera() {
    const keys = [[0, overview, ${VH / 2}]];
    moves = [];
    let section = null;
    // The poster area a view shows above the bottom captions and below the top safe zone.
    const shows = (v, b) => b.x >= v.x - ${VW / 2} / v.k && b.x + b.w <= v.x + ${VW / 2} / v.k && b.y >= v.y - (frameMid - ${SAFE_TOP}) / v.k && b.y + b.h <= v.y + (frameH + ${SAFE_TOP} - frameMid) / v.k;
    const starts = beats.map(b => b.visualStartSeconds + OPEN);
    cameraShots(starts, beats.map(b => !!b.cell), beats.map(b => b.panel), total + OPEN).forEach((shot, j) => {
      const own = shot.map(i => beats[i]), cells = own.map(b => b.cell).filter(Boolean), last = keys.at(-1);
      let target = overview, mid = ${VH / 2};
      if (cells.length) {
        const box = cells.reduce(union);
        target = view(box); mid = frameMid;
        // The first shot of a section also shows the section title, when it fits whole and keeps the cells large.
        const sec = own.find(b => b.cell).section, s = layout.sections[sec], title = { x: s.frame.x, y: s.frame.y, w: s.labelW, h: s.head };
        if (sec !== section) { const titled = view(union(title, box)); if (titled.k >= target.k * 0.7 && shows(titled, title)) target = titled; }
        section = sec;
      }
      if (target === last[1]) return;
      // Longer moves take a little longer (up to 1.8 s). The previous shot is held at least ${MIN_SHOT} s; if that makes the
      // camera arrive after this shot's scenes have started, they wait and are drawn as it arrives.
      const dur = j === 0 ? Math.max(0.6, Math.min(1.2, starts[shot[0]] - 0.9))
        : Math.min(1.8, ${MOVE} + Math.hypot(target.x - last[1].x, target.y - last[1].y) / 3000);
      const arrive = j === 0 ? starts[shot[0]] : Math.max(starts[shot[0]], last[0] + ${MIN_SHOT} + dur), leave = arrive - dur;
      shot.forEach(i => { beats[i].lag = Math.max(0, arrive - starts[i]); });
      if (leave > last[0] + 1e-3) keys.push([leave, last[1], last[2]]);
      keys.push([arrive, target, mid]);
      moves.push({ t: leave, dur });
    });
    const end = total + OPEN, last = keys.at(-1);
    keys.push([Math.max(last[0] + 0.05, end + 0.1), last[1], last[2]], [end + 1.5, overview, ${VH / 2}], [end + CLOSE, overview, ${VH / 2}]);
    moves.push({ t: end + 0.1, dur: 1.4 });
    const ts = keys.map(k => k[0]);
    const fx = monotoneCubic(ts, keys.map(k => k[1].x)), fy = monotoneCubic(ts, keys.map(k => k[1].y));
    const fk = monotoneCubic(ts, keys.map(k => Math.log(k[1].k))), fm = monotoneCubic(ts, keys.map(k => k[2]));
    cam = t => ({ x: fx(t), y: fy(t), k: Math.exp(fk(t)), mid: fm(t) });
  }
  let boiled = 0;
  window.render = t => {
    const tv = Math.floor(t * STEP + 1e-6) / STEP;  // visuals on 15 fps steps
    const c = cam(tv);
    poster.style.transform = 'translate(' + (${VW / 2} - c.x * c.k) + 'px,' + (c.mid - c.y * c.k) + 'px) scale(' + c.k + ')';
    poster.style.setProperty('--zw', (1 / c.k).toFixed(4));
    document.querySelectorAll('#decor [data-k]').forEach(el => { const p = ease((tv - +el.dataset.t) / +el.dataset.d);
      if (el.dataset.k === 'draw') el.style.strokeDashoffset = 1 - p; else el.style.opacity = p; });
    const boil = Math.floor(tv * 6) % 3 + 1;
    if (boil !== boiled) { boiled = boil; poster.querySelectorAll('.pen').forEach(el => el.setAttribute('filter', 'url(#pencil' + boil + ')')); }
    beats.forEach((b, i) => {
      const svg = svgs[i], start = b.visualStartSeconds + OPEN + (b.lag || 0), local = (tv - start) / b.timeScale;
      if (!svg) return;
      svg.style.visibility = tv >= start - 0.05 ? 'visible' : 'hidden';
      if (tv < start - 0.05) return;
      svg.querySelectorAll('[data-k]').forEach(el => {
        const g = +(el.dataset.g || 0), cue = b.cueSeconds?.[g] ?? g * .45;
        const s = cue / b.timeScale + +el.dataset.s, d = +el.dataset.d, p = ease((local - s) / d), k = el.dataset.k;
        if (k === 'draw') { el.style.strokeDashoffset = 1 - p; el.style.opacity = p > 0 ? 1 : 0; el.style.fillOpacity = Math.min(1, p * 1.6); }
        else if (k === 'fade') { el.style.opacity = p; el.style.transform = 'translateY(' + (1 - p) * 8 + 'px)'; }
        else if (k === 'grow-x' || k === 'grow-y') { el.style.transformBox = 'fill-box';
          el.style.transformOrigin = k === 'grow-x' ? 'left center' : 'center bottom';
          el.style.transform = (k === 'grow-x' ? 'scaleX(' : 'scaleY(') + p + ')'; }
        else if (k === 'character') {
          el._sweep.setAttribute('width', +el.getAttribute('width') * ease((local - s) / (d * .8)));
          const o = ease((local - s - d * .6) / (d * .5)); el.style.opacity = o; el._line.style.opacity = 1 - o;
          // Idle breathing: a slight tilt (±2.5°) and swell (1.00–1.02) every 2.6 s, anchored at the feet.
          const ph = (tv + i * 0.7) / 2.6 * Math.PI * 2;
          el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center bottom';
          el.style.transform = 'rotate(' + (2.5 * Math.sin(ph)).toFixed(2) + 'deg) scale(' + (1.01 + 0.01 * Math.sin(ph * 2)).toFixed(4) + ')'; }
      });
    });
    const at = t - OPEN, line = captions.find(c => c.startSeconds <= at && at < c.endSeconds), cap = document.getElementById('cap');
    const escH = v => v.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
    const text = line ? line.text : '', bold = line?.bold?.[0], pos = bold ? text.indexOf(bold) : -1;
    cap.innerHTML = !line ? '' : '<span>' + (pos < 0 ? escH(text) : escH(text.slice(0, pos)) + '<b>' + escH(bold) + '</b>' + escH(text.slice(pos + bold.length))) + '</span>';
  };
  // Sounds (video time): a scene-change pop, each drawn part, character entrances, red accents, and a soft camera whoosh.
  window.soundCues = () => {
    const events = [];
    beats.forEach((b, i) => {
      const start = b.visualStartSeconds + OPEN + (b.lag || 0);
      if (i) events.push({ t: start, kind: 'transition' });
      const groups = new Map();
      svgs[i]?.querySelectorAll('[data-k]').forEach(el => {
        const g = +(el.dataset.g || 0), k = el.dataset.k === 'character' ? 'appear' : el.classList.contains('r') || el.classList.contains('acc') ? 'accent' : 'build';
        const rank = { appear: 3, build: 2, accent: 1 };
        if (!groups.has(g) || rank[k] > rank[groups.get(g)]) groups.set(g, k);
      });
      groups.forEach((kind, g) => events.push({ t: start + (b.cueSeconds?.[g] ?? g * .45) + (g ? 0 : .12), kind }));
    });
    events.sort((a, b) => a.t - b.t);
    const kept = events.filter((e, i) => !i || e.t - events[i - 1].t >= .25);
    return kept.concat(moves.map(m => ({ t: m.t, kind: 'move', dur: m.dur })));
  };
  // Final-state geometry of a scene at its end: inside the visible band, no text collisions, no text over artwork.
  window.inspectBeat = i => {
    // Checked mid-scene, when the camera has settled on it.
    const b = beats[i]; window.render(b.visualStartSeconds + OPEN + (b.lag || 0) + Math.max(0.5, (b.endSeconds - b.visualStartSeconds) * 0.6));
    const problems = [], box = el => el.getBoundingClientRect();
    const svg = svgs[i]; if (!svg) return [];
    const items = [...svg.querySelectorAll('[data-k]')].filter(el => el.tagName !== 'g');
    for (const el of items) { const r = box(el);
      if (r.width && (r.left < -1 || r.right > ${VW} + 1 || r.top < ${SAFE_TOP} - 1 || r.bottom > ${VH - SAFE_BOTTOM} + 1)) problems.push(el.tagName + ' outside safe area'); }
    const texts = [...svg.querySelectorAll('text')].map(box), art = [...svg.querySelectorAll('image[data-k]')].map(box);
    const hit = (a, c, pad) => a.left < c.right + pad && c.left < a.right + pad && a.top < c.bottom + pad && c.top < a.bottom + pad;
    texts.forEach((a, m) => texts.slice(m + 1).forEach(c => { if (hit(a, c, 4)) problems.push('labels overlap'); }));
    texts.forEach(a => art.forEach(c => { if (hit(a, c, 0)) problems.push('label covers character'); }));
    return problems;
  };
  </script></body></html>`;
}

async function main() {
  const { values: args } = parseArgs({ options: {
    brief: { type: "string" }, audio: { type: "string" }, catalog: { type: "string" }, output: { type: "string" },
    "allow-provisional-study": { type: "boolean" }, "check-only": { type: "boolean" } } });
  if (!args.brief || !args.audio || !args.catalog || (!args.output && !args["check-only"])) fail("--brief, --audio, --catalog and --output are required");
  const brief = JSON.parse(readFileSync(args.brief, "utf8"));
  const catalog = JSON.parse(readFileSync(args.catalog, "utf8"));
  const audio = readFileSync(args.audio);
  const probed = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", args.audio], { encoding: "utf8" }));
  const { duration, used } = checkBrief(brief, audio, probed, catalog, args["allow-provisional-study"]);
  const root = path.dirname(path.resolve(args.catalog));
  const characters = new Map();
  for (const id of used) {
    const asset = catalog.assets.find((item) => item.id === id);
    const file = path.resolve(root, asset.file);
    const bytes = readFileSync(file);
    if (!file.startsWith(root + path.sep) || sha256(bytes) !== asset.sha256) fail(`Character asset path or checksum changed: ${id}`);
    characters.set(id, `data:image/png;base64,${bytes.toString("base64")}`);
  }
  const beats = brief.timeline.beats.map((beat) => ({ ...beat, timeScale: 1 }));
  const poster = brief.timeline.poster?.sections?.length ? brief.timeline.poster
    : { title: "", sections: [{ label: "", panels: [...new Set(beats.map((b) => b.segmentIndex))].map((segmentIndex) => ({ segmentIndex, importance: 2 })) }] };
  // Caption-only scenes get no cell; a paragraph left with nothing to draw gets no panel.
  const counts = new Map();
  beats.filter((b) => !blankBeat(b)).forEach((b) => counts.set(b.segmentIndex, (counts.get(b.segmentIndex) ?? 0) + 1));
  const shown = { ...poster, sections: poster.sections.map((s) => ({ ...s, panels: s.panels.filter((p) => counts.get(p.segmentIndex)) })).filter((s) => s.panels.length) };
  const layout = posterLayout(shown, counts);
  const video = duration + OPEN + CLOSE;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    const captions = (brief.timeline.captions ?? []).filter((c) => typeof c.text === "string" && c.endSeconds > c.startSeconds);
    await page.setContent(pageHtml(beats, characters, await fontFaces(), captions, layout, posterDecor(layout, poster.title), duration), { waitUntil: "load" });
    if (!await page.evaluate(async () => { const specs = ['500 46px "Pretendard"', '700 60px "Gaegu"', '400 90px "Jua"']; for (const spec of specs) await document.fonts.load(spec, "가A"); return specs.every((spec) => document.fonts.check(spec, "가A")); }))
      fail("Fonts did not load");
    await page.evaluate(() => window.layoutBeats());
    const problems = [];
    for (let i = 0; i < beats.length; i++)
      for (const problem of new Set(await page.evaluate((n) => window.inspectBeat(n), i))) problems.push(`beat ${i + 1} (${beats[i].spokenAnchor}): ${problem}`);
    // Layout findings block a check-only run; a real render records them for review instead of discarding the video.
    if (problems.length && args["check-only"]) fail(`Layout check failed:\n${problems.join("\n")}`);
    if (problems.length) console.warn(`layout warnings (${problems.length}):\n${problems.join("\n")}`);
    if (args["check-only"]) return console.log(`layout ok: ${beats.length} beats`);
    mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    // YouTube description chapters from the poster sections (video time).
    const starts = layout.sections.map((s, i) => { const own = beats.filter((b) => shown.sections[i].panels.some((p) => p.segmentIndex === b.segmentIndex)); return { label: s.label, start: (own[0]?.visualStartSeconds ?? 0) + OPEN }; });
    const chapters = youtubeChapters(starts.map((s, i) => ({ ...s, end: starts[i + 1]?.start ?? video })));
    writeFileSync(`${args.output}.chapters.txt`, `${chapters.text}\n${chapters.ok ? "" : "# 유튜브 챕터 조건(3개 이상, 각 10초 이상)을 채우지 못함\n"}`);
    const effects = path.join(os.tmpdir(), `brandyaction-effects-${process.pid}.wav`), mixed = path.join(os.tmpdir(), `brandyaction-mix-${process.pid}.wav`);
    writeFileSync(effects, effectTrack(await page.evaluate(() => window.soundCues()), video));
    // Narration starts after the opening; the mix is limited, measured once, then levelled linearly to -14 LUFS.
    const delay = Math.round(OPEN * 1000);
    const chain = `[0:a]adelay=${delay}:all=1,apad=whole_dur=${video.toFixed(2)},highpass=f=70,afftdn=nf=-30[v];[1:a]lowpass=f=6000,volume=0.5[e];[v][e]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.5:level=false`;
    const measured = spawnSync("ffmpeg", ["-hide_banner", "-i", args.audio, "-i", effects, "-filter_complex", `${chain},loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"],
      { encoding: "utf8" }).stderr;
    const m = JSON.parse(measured.slice(measured.lastIndexOf("{"), measured.lastIndexOf("}") + 1));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", args.audio, "-i", effects, "-filter_complex",
      `${chain},loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`, "-t", video.toFixed(2), mixed]);
    // Frames are drawn at 15 fps (motion on twos) and the file is written at 30 fps.
    const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(STEP_FPS), "-i", "pipe:0", "-i", mixed,
      "-map", "0:v", "-map", "1:a", "-t", video.toFixed(2), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", args.output], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((resolve, reject) => ffmpeg.on("close", (code) => code ? reject(new Error("Video encoder failed")) : resolve()));
    for (let frame = 0; frame < Math.ceil(video * STEP_FPS); frame++) {
      await page.evaluate((t) => window.render(t), frame / STEP_FPS);
      if (!ffmpeg.stdin.write(await page.screenshot({ type: "jpeg", quality: 92 }))) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    }
    ffmpeg.stdin.end();
    await done;
    console.log(args.output);
    console.log(`chapters:\n${chapters.text}`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
