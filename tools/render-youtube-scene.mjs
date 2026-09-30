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
const W = 1280, H = 720;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };
// Pretendard (captions, chapter bar) and Gaegu (hand-written scene text), both OFL-1.1, render identically on every worker.
const FONTS = [
  ["Pretendard", 600, "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-SemiBold.woff2", "c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0", "woff2"],
  ["Pretendard", 800, "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-ExtraBold.woff2", "dd7c1e156f508eb962acc7a33a7a1896d1e0b71e11156fad96e731689ceb6dc3", "woff2"],
  ["Gaegu", 700, "https://cdn.jsdelivr.net/gh/google/fonts@16680f8688ffcd467d2eb2146a9ce0343404581d/ofl/gaegu/Gaegu-Bold.ttf", "cc38a4af9506a45254d1ce07c589ec473d9e5f0be319e5a77b17c214903f8c1c", "truetype"],
];

async function fontFaces() {
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
 * Effect sounds are synthesized here, so no audio files or licences are involved. Four kinds, used the same way everywhere:
 * transition (scene change), build (a part is drawn), appear (a character enters), accent (a red underline or ring).
 * Returns a 16-bit mono WAV with each sound placed at its time.
 */
export function effectTrack(events, duration, rate = 48_000) {
  const out = new Float32Array(Math.ceil((duration + 1) * rate));
  // mulberry32: 32-bit integer maths keeps the noise non-repeating. (A plain LCG in floating point repeated every
  // 419 samples, which turned the whoosh into a ~115 Hz buzz that sounded like a laser.)
  let seed = 7;
  const noise = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 2 ** 31 - 1; };
  // Soft, low sounds only: no pitch sweeps and no bright noise, so they sit quietly under the voice.
  const sound = {
    transition: (t) => { const p = t / 0.45; return p > 1 ? null : Math.sin(Math.PI * p) ** 2 * 0.3; }, // a dark air whoosh
    build: (t) => (t > 0.16 ? null : (Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 880 * t)) * Math.min(1, t * 250) * Math.exp(-t * 32) * 0.28), // a muted tap
    appear: (t) => (t > 0.7 ? null : (Math.sin(2 * Math.PI * 392 * t) + 0.6 * Math.sin(2 * Math.PI * 587 * t)) * Math.min(1, t * 60) * Math.exp(-t * 6) * 0.14), // a gentle two-note chime
    accent: (t) => { const p = t / 0.22; return p > 1 ? null : Math.sin(Math.PI * p) * 0.22; }, // a soft paper brush
  };
  for (const { t, kind } of events) {
    // Noise-based sounds (transition, accent) are low-passed so they stay dark; tones are written directly.
    let low = 0;
    for (let i = Math.round(t * rate), n = 0; i < out.length; i++, n++) {
      const env = sound[kind](n / rate);
      if (env === null) break;
      if (kind === "transition") { low += (0.02 + 0.1 * Math.sin(Math.PI * n / rate / 0.45)) * (noise() - low); out[i] += low * env * 2; }
      else if (kind === "accent") { low += 0.12 * (noise() - low); out[i] += low * env * 1.5; }
      else out[i] += env;
    }
  }
  const wav = Buffer.alloc(44 + out.length * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + out.length * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(out.length * 2, 40);
  out.forEach((v, i) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32_767), 44 + i * 2));
  return wav;
}

/** Scenes are drawn between the chapter bar at the top and the spoken caption at the bottom. */
const STAGE_TOP = 90, STAGE_BOTTOM = 590;
/** Scene frames on the continuous sheet: columns per row and the distance between frames. */
const SHEET_COLUMNS = 3, SHEET_STEP_X = 1350, SHEET_STEP_Y = 660;
/** Gaegu draws Hangul smaller than Pretendard at the same size; template sizes are scaled by this. */
const GAEGU_SCALE = 1.15;

export function pageHtml(beats, characters, faces, captions = [], chapters = [], duration = 0) {
  const style = `.i{stroke:${C.ink};stroke-width:4;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .r{stroke:${C.red};stroke-width:4;fill:none;stroke-linecap:round;stroke-linejoin:round} .thin{stroke-width:3} .bold{stroke-width:6} .p{fill:${C.pale}}
    text{font-family:"Gaegu";font-weight:700;fill:${C.ink};text-anchor:middle;dominant-baseline:middle;stroke:none}
    .lab{font-size:30px} .sm{font-size:26px;fill:${C.muted};font-weight:600} .acc{fill:${C.red};font-weight:800} .muted{fill:${C.muted}}
    .b7,.b8,.acc,.sm{font-weight:700} .start{text-anchor:start} .end{text-anchor:end} .inv{fill:#fff}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
  html,body{margin:0;width:${W}px;height:${H}px;background:${C.paper};overflow:hidden}
  #sheet{position:absolute;left:0;top:0;transform-origin:0 0} #sheet>svg{position:absolute;overflow:visible}
  /* Spoken caption in the bottom safe area; one phrase in bold. */
  #cap{position:absolute;left:0;right:0;bottom:56px;text-align:center;font:500 36px "Pretendard";color:#2a2d30;letter-spacing:-.5px;white-space:nowrap;z-index:2}
  #cap b{font-weight:800;color:${C.ink}}
  /* Chapter bar: one segment per named part, filling as the video plays, with the current part named. */
  #bar{position:absolute;left:40px;right:40px;top:22px;display:flex;gap:6px;z-index:2}
  #bar div{position:relative;height:6px;border-radius:3px;background:${C.line};overflow:visible}
  #bar i{position:absolute;inset:0 auto 0 0;border-radius:3px;background:${C.red}}
  #bar span{position:absolute;left:0;top:13px;font:500 19px "Pretendard";color:${C.muted};white-space:nowrap}
  #bar div.on span{font-weight:800;color:${C.ink}}</style></head><body><div id="bar"></div><div id="cap"></div>
  <svg width="0" height="0" style="position:absolute">${[1, 2, 3].map((n) => `<filter id="pencil${n}" filterUnits="userSpaceOnUse" x="-3000" y="-3000" width="9000" height="9000"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${n * 7}"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter>`).join("")}</svg>
  <div id="sheet">${beats.map((beat, i) => `<svg id="b${i}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:none"><style>${style}</style>
    <defs><filter id="line${i}"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 1 1 1"/><feFuncG type="discrete" tableValues="0 1 1 1"/><feFuncB type="discrete" tableValues="0 1 1 1"/></feComponentTransfer></filter></defs>
    ${beat.svg.replace(/<image data-character="([a-z0-9_-]+)"/g, (_, id) => `<image href="${characters.get(id)}" preserveAspectRatio="xMidYMid meet" data-character="${id}"`)}</svg>`).join("")}</div>
  <script>
  const beats = ${JSON.stringify(beats.map((beat) => ({ ...beat, svg: undefined })))};
  const captions = ${JSON.stringify(captions)};
  const chapters = ${JSON.stringify(chapters)}, total = ${Number(duration) || 0};
  const bar = document.getElementById('bar');
  // A video with fewer than two named parts shows no chapter bar.
  const parts = chapters.length > 1 && total > 0 ? chapters.map((c, i) => ({ ...c, end: chapters[i + 1]?.startSeconds ?? total })) : [];
  parts.forEach(p => { const d = document.createElement('div'); d.style.flex = String(Math.max(0.01, p.end - p.startSeconds));
    d.innerHTML = '<i></i><span></span>'; d.querySelector('span').textContent = p.label; bar.appendChild(d); });
  const ease = v => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
  document.querySelectorAll('[data-k="draw"]').forEach(el => { el.setAttribute('pathLength', 1); el.style.strokeDasharray = 1; });
  document.querySelectorAll('image[data-k="character"]').forEach((img, n) => {
    const svg = img.ownerSVGElement, i = svg.id.slice(1), ns = 'http://www.w3.org/2000/svg';
    const clip = document.createElementNS(ns, 'clipPath'); clip.id = 'sweep' + i + '-' + n;
    const rect = document.createElementNS(ns, 'rect');
    ['x', 'y', 'height'].forEach(a => rect.setAttribute(a, img.getAttribute(a === 'height' ? 'height' : a)));
    rect.setAttribute('width', 0); clip.appendChild(rect); svg.querySelector('defs').appendChild(clip);
    const line = img.cloneNode(); line.removeAttribute('data-k');
    line.setAttribute('filter', 'url(#line' + i + ')'); line.setAttribute('clip-path', 'url(#' + clip.id + ')');
    img.parentNode.insertBefore(line, img); img._sweep = rect;
  });
  // After fonts load: draw emphasis from measured text, then enlarge and centre each scene below the caption.
  window.layoutBeats = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const add = (svg, tag, attrs, after) => { const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); after.after(el);
      if (attrs['data-k'] === 'draw') { el.setAttribute('pathLength', 1); el.style.strokeDasharray = 1; } return el; };
    // Gaegu's Hangul sits small in its em box; enlarge it to read like the template size.
    document.querySelectorAll('#sheet text').forEach(el => el.setAttribute('font-size', (+el.getAttribute('font-size') || 30) * ${GAEGU_SCALE}));
    document.querySelectorAll('svg[id^="b"]').forEach((svg, i) => {
      svg.style.display = '';
      svg.querySelectorAll('.ul').forEach(el => { const b = el.getBBox(), host = el.closest('text'), y = b.y + b.height + 6;
        const w = b.width;
        add(svg, 'path', { class: 'r bold', d: 'M' + b.x + ' ' + (y + 4) + 'C' + (b.x + w * .25) + ' ' + (y - 8) + ' ' + (b.x + w * .55) + ' ' + (y + 10) + ' ' + (b.x + w) + ' ' + (y - 4), 'data-k': 'draw', 'data-g': host.dataset.g || 0, 'data-s': (+host.dataset.s || 0) + .45, 'data-d': .35 }, host); });
      svg.querySelectorAll('text.ring').forEach(el => { const b = el.getBBox();
        add(svg, 'ellipse', { class: 'r', cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2 + 34, ry: b.height / 2 + 16, 'data-k': 'draw', 'data-g': el.dataset.g || 0, 'data-s': (+el.dataset.s || 0) + .4, 'data-d': .4 }, el); });
      const group = document.createElementNS(ns, 'g');
      [...svg.childNodes].filter(n => !['style', 'defs'].includes(n.nodeName)).forEach(n => group.appendChild(n));
      svg.appendChild(group);
      const b = group.getBBox();
      if (b.width && b.height) {
        const font = Math.max(1, ...[...svg.querySelectorAll('text')].map(t => +t.getAttribute('font-size') || 30));
        // A fixed layout (columns centred in each half) keeps its size and only moves vertically.
        const fixed = svg.querySelector('.fixed');
        const k = fixed ? 1 : Math.min(1.4, 96 / font, ${SAFE.x2 - SAFE.x1} / b.width, ${STAGE_BOTTOM - STAGE_TOP} / b.height);
        const dx = fixed ? 0 : 640 - (b.x + b.width / 2) * k, dy = ${(STAGE_TOP + STAGE_BOTTOM) / 2} - (b.y + b.height / 2) * k;
        group.setAttribute('transform', 'translate(' + dx.toFixed(1) + ' ' + dy.toFixed(1) + ') scale(' + k.toFixed(3) + ')');
      }
      svg.style.display = 'none';
    });
    layoutSheet();
  };
  // One continuous sheet: scenes run left→right, then right→left on the next row, so each move is short. The camera follows
  // what has just been drawn, whips with a slight settle to each new scene, and pulls back over a part's last scenes at its end.
  const svgs = [...document.querySelectorAll('#sheet > svg')], sheet = document.getElementById('sheet');
  let keys = [], links = [], pulls = [];
  const easeBack = x => { x = Math.max(0, Math.min(1, x)); return 1 + 2.3 * (x - 1) ** 3 + 1.3 * (x - 1) ** 2; };
  const lerp = (a, b, e) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, k: a.k + (b.k - a.k) * e });
  const union = boxes => boxes.reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }));
  const camAt = (key, t) => lerp(key.from, key.to, (key.whip ? easeBack : ease)((t - key.t) / key.dur));
  function layoutSheet() {
    const ns = 'http://www.w3.org/2000/svg';
    const spot = i => { const row = Math.floor(i / ${SHEET_COLUMNS}), col = i % ${SHEET_COLUMNS}; return { x: (row % 2 ? ${SHEET_COLUMNS} - 1 - col : col) * ${SHEET_STEP_X}, y: row * ${SHEET_STEP_Y} }; };
    svgs.forEach((svg, i) => { const p = spot(i); svg.style.left = p.x + 'px'; svg.style.top = p.y + 'px'; svg.style.display = ''; svg.style.visibility = 'visible';
      svg.querySelectorAll('.i,.r,rect,circle,ellipse,line,path,polyline').forEach(el => el.classList.add('pen')); });
    // Where each scene's parts land on the sheet, accumulated per reveal group.
    const extents = svgs.map((svg, i) => {
      const groups = new Map();
      svg.querySelectorAll('[data-k]').forEach(el => {
        if (el.tagName === 'g') return;
        const r = el.getBoundingClientRect(), g = +(el.dataset.g || 0);
        if (!r.width && !r.height) return;
        const box = { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
        groups.set(g, groups.has(g) ? union([groups.get(g), box]) : box);
      });
      let acc = null;
      return [...groups.keys()].sort((a, b) => a - b).map(g => {
        acc = acc ? union([acc, groups.get(g)]) : groups.get(g);
        return { t: beats[i].visualStartSeconds + (g ? (beats[i].cueSeconds?.[g] ?? g * .45) : 0), box: acc };
      });
    });
    svgs.forEach(svg => { svg.style.display = 'none'; svg.style.visibility = ''; });
    const view = (box, fill = 1) => { const w = box.x2 - box.x1 + 160, h = box.y2 - box.y1 + 120;
      return { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2, k: fill < 1 ? Math.min(1120 / w, 470 / h) : Math.max(.8, Math.min(1.2, 1120 / w, 470 / h)) }; };
    keys = extents.flatMap((list, i) => list.map((e, n) => ({ t: e.t, to: view(e.box), dur: n || !i ? .8 : .6, whip: !n && i > 0 })));
    // At the end of each named part, pull back over its last scenes (up to six) before the next part begins.
    pulls = chapters.length > 1 ? chapters.map((c, n) => {
      const end = chapters[n + 1]?.startSeconds ?? total, own = extents.filter((list, i) => list.length && beats[i].visualStartSeconds >= c.startSeconds - .01 && beats[i].visualStartSeconds < end);
      return own.length > 1 && end - c.startSeconds > 8 ? { t: end - 2.4, to: view(union(own.slice(-6).map(list => list.at(-1).box)), 0), dur: 1.2, pull: true, end } : null;
    }).filter(Boolean) : [];
    keys = keys.filter(key => !pulls.some(p => key.t >= p.t && key.t < p.end)).concat(pulls).sort((a, b) => a.t - b.t);
    keys.forEach((key, n) => { key.from = n ? camAt(keys[n - 1], key.t) : key.to; });
    // A pencil line from the last drawing of one scene to the first of the next, drawn during the move.
    const link = document.createElementNS(ns, 'svg');
    link.setAttribute('width', 1); link.setAttribute('height', 1); link.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
    sheet.insertBefore(link, sheet.firstChild);
    links = extents.slice(1).map((next, k) => {
      if (!extents[k].length || !next.length) return null;
      const a = extents[k].at(-1).box, b = next[0].box, ac = { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 }, bc = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
      const across = Math.abs(bc.x - ac.x) > Math.abs(bc.y - ac.y), right = bc.x > ac.x;
      const from = across ? { x: right ? a.x2 + 30 : a.x1 - 30, y: ac.y + 40 } : { x: ac.x - 80, y: a.y2 + 30 };
      const to = across ? { x: right ? b.x1 - 30 : b.x2 + 30, y: bc.y + 40 } : { x: bc.x - 80, y: b.y1 - 30 };
      const bend = across ? { x: (from.x + to.x) / 2, y: Math.max(from.y, to.y) + 160 } : { x: Math.min(from.x, to.x) - 220, y: (from.y + to.y) / 2 };
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M' + from.x + ' ' + from.y + 'Q' + bend.x + ' ' + bend.y + ' ' + to.x + ' ' + to.y);
      path.setAttribute('class', 'pen'); path.setAttribute('pathLength', 1);
      path.style.cssText = 'stroke:${C.ink};stroke-width:4;fill:none;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1';
      link.appendChild(path);
      return { path, t: beats[k + 1].visualStartSeconds };
    }).filter(Boolean);
  }
  let boiled = 0;
  window.render = t => {
    const active = beats.findIndex(b => b.visualStartSeconds <= t && t < b.endSeconds);
    const reached = beats.reduce((last, b, i) => (b.visualStartSeconds <= t ? i : last), -1);
    // Scenes stay on the sheet once drawn; only the few near the camera are painted.
    beats.forEach((b, i) => { const svg = svgs[i], near = i <= reached && i > reached - 7;
      svg.style.display = near ? '' : 'none';
      if (near && i !== active) svg.querySelectorAll('[data-k]').forEach(el => { const k = el.dataset.k;
        if (k === 'draw') { el.style.strokeDashoffset = 0; el.style.opacity = 1; el.style.fillOpacity = 1; }
        else if (k === 'fade') { el.style.opacity = 1; el.style.transform = 'none'; }
        else if (k === 'grow-x' || k === 'grow-y') el.style.transform = 'none';
        else if (k === 'character') { el._sweep.setAttribute('width', el.getAttribute('width')); el.style.opacity = 1; } }); });
    const boil = Math.floor(t * 12) % 3 + 1;
    if (boil !== boiled) { boiled = boil; sheet.querySelectorAll('.pen').forEach(el => el.setAttribute('filter', 'url(#pencil' + boil + ')')); }
    // A connector is drawn during the move, fades once the camera arrives, and shows again during a pull back.
    const pulling = pulls.some(p => t >= p.t && t < p.end);
    links.forEach(l => { l.path.style.strokeDashoffset = 1 - ease((t - l.t + .1) / .6); l.path.style.opacity = pulling ? .6 : 1 - ease((t - l.t - .7) / .4); });
    const key = [...keys].reverse().find(k => k.t <= t) ?? keys[0];
    if (key) { const cam = camAt(key, t), p = (t - key.t) / key.dur, blur = (key.whip || key.pull) && p < 1 ? Math.sin(Math.PI * p) * 2 : 0;
      sheet.style.transform = 'translate(' + (640 - cam.x * cam.k) + 'px,' + (${(STAGE_TOP + STAGE_BOTTOM) / 2} - cam.y * cam.k) + 'px) scale(' + cam.k + ')';
      svgs.forEach(svg => { svg.style.filter = blur > .4 ? 'blur(' + blur.toFixed(2) + 'px)' : ''; }); }
    const cap = document.getElementById('cap'), line = captions.find(c => c.startSeconds <= t && t < c.endSeconds);
    const esc = v => v.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const bold = line?.bold?.[0], at = bold ? line.text.indexOf(bold) : -1;
    cap.innerHTML = !line ? '' : at < 0 ? esc(line.text) : esc(line.text.slice(0, at)) + '<b>' + esc(bold) + '</b>' + esc(line.text.slice(at + bold.length));
    [...bar.children].forEach((d, i) => { const p = parts[i], f = Math.max(0, Math.min(1, (t - p.startSeconds) / (p.end - p.startSeconds)));
      d.querySelector('i').style.width = (f * 100) + '%'; d.classList.toggle('on', p.startSeconds <= t && t < p.end); });
    if (active < 0) return;
    svgs[active].style.display = '';
    const b = beats[active], local = (t - b.visualStartSeconds) / b.timeScale;
    document.getElementById('b' + active).querySelectorAll('[data-k]').forEach(el => {
      const g = +(el.dataset.g || 0), cue = b.cueSeconds?.[g] ?? g * .45;
      const s = cue / b.timeScale + +el.dataset.s, d = +el.dataset.d, p = ease((local - s) / d), k = el.dataset.k;
      if (k === 'draw') { el.style.strokeDashoffset = 1 - p; el.style.opacity = p > 0 ? 1 : 0; el.style.fillOpacity = Math.min(1, p * 1.6); }
      else if (k === 'fade') { el.style.opacity = p; el.style.transform = 'translateY(' + (1 - p) * 8 + 'px)'; }
      else if (k === 'grow-x' || k === 'grow-y') { el.style.transformBox = 'fill-box';
        el.style.transformOrigin = k === 'grow-x' ? 'left center' : 'center bottom';
        el.style.transform = (k === 'grow-x' ? 'scaleX(' : 'scaleY(') + p + ')'; }
      else if (k === 'character') {
        el._sweep.setAttribute('width', +el.getAttribute('width') * ease((local - s) / (d * .8)));
        el.style.opacity = ease((local - s - d * .6) / (d * .5)); }
    });
  };
  // When each effect sound plays: scene changes, each drawn part, character entrances and red accents; close sounds keep the first.
  window.soundCues = () => {
    const events = [];
    beats.forEach((b, i) => {
      if (i) events.push({ t: b.visualStartSeconds, kind: 'transition' });
      const groups = new Map();
      document.getElementById('b' + i).querySelectorAll('[data-k]').forEach(el => {
        const g = +(el.dataset.g || 0), k = el.dataset.k === 'character' ? 'appear' : el.classList.contains('r') || el.classList.contains('acc') ? 'accent' : 'build';
        const rank = { appear: 3, build: 2, accent: 1 };
        if (!groups.has(g) || rank[k] > rank[groups.get(g)]) groups.set(g, k);
      });
      groups.forEach((kind, g) => events.push({ t: b.visualStartSeconds + (b.cueSeconds?.[g] ?? g * .45) + (g ? 0 : .12), kind }));
    });
    pulls.forEach(p => events.push({ t: p.t, kind: 'transition' }));
    events.sort((a, b) => a.t - b.t);
    return events.filter((e, i) => !i || e.t - events[i - 1].t >= .25);
  };
  // Final-state geometry: stage area, text collisions, text over artwork.
  window.inspectBeat = i => {
    const b = beats[i]; window.render(b.endSeconds - 0.001);
    const problems = [], box = el => el.getBoundingClientRect();
    const svg = document.getElementById('b' + i), items = [...svg.querySelectorAll('[data-k]')].filter(el => el.tagName !== 'g');
    for (const el of items) { const r = box(el);
      if (r.width && (r.left < ${SAFE.x1} - 1 || r.right > ${SAFE.x2} + 1 || r.top < ${STAGE_TOP} - 1 || r.bottom > ${STAGE_BOTTOM} + 1))
        problems.push(el.tagName + ' outside safe area'); }
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
    fps: { type: "string", default: "24" }, "allow-provisional-study": { type: "boolean" }, "check-only": { type: "boolean" } } });
  if (!args.brief || !args.audio || !args.catalog || (!args.output && !args["check-only"])) fail("--brief, --audio, --catalog and --output are required");
  const fps = Number(args.fps);
  if (!(fps >= 12 && fps <= 30)) fail("FPS outside supported range");
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
  // Drawings authored at natural pace are compressed to finish before the beat ends.
  const beats = brief.timeline.beats.map((beat) => {
    const summary = validateSceneSvg(beat.svg, new Set(characters.keys())).summary;
    const room = Math.max(0.3, beat.endSeconds - beat.visualStartSeconds - 0.25);
    // Cue-timed beats already follow the narration; older briefs compress their drawing to fit the beat.
    return { ...beat, timeScale: beat.cueSeconds ? 1 : Math.min(1, room / Math.max(0.01, summary.drawSeconds)) };
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const captions = (brief.timeline.captions ?? []).filter((c) => typeof c.text === "string" && c.endSeconds > c.startSeconds);
    await page.setContent(pageHtml(beats, characters, await fontFaces(), captions, brief.timeline.chapters ?? [], duration), { waitUntil: "load" });
    if (!await page.evaluate(async () => { const specs = ['800 52px "Pretendard"', '600 30px "Pretendard"']; for (const spec of specs) await document.fonts.load(spec, "가A"); return specs.every((spec) => document.fonts.check(spec, "가A")); }))
      fail("Pretendard did not load");
    await page.evaluate(() => window.layoutBeats());
    const problems = [];
    for (let i = 0; i < beats.length; i++)
      for (const problem of new Set(await page.evaluate((n) => window.inspectBeat(n), i))) problems.push(`beat ${i + 1} (${beats[i].spokenAnchor}): ${problem}`);
    // Layout findings block a check-only run; a real render records them for review instead of discarding the video.
    if (problems.length && args["check-only"]) fail(`Layout check failed:\n${problems.join("\n")}`);
    if (problems.length) console.warn(`layout warnings (${problems.length}):\n${problems.join("\n")}`);
    if (args["check-only"]) return console.log(`layout ok: ${beats.length} beats`);
    mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    const effects = path.join(os.tmpdir(), `brandyaction-effects-${process.pid}.wav`), mixed = path.join(os.tmpdir(), `brandyaction-mix-${process.pid}.wav`);
    writeFileSync(effects, effectTrack(await page.evaluate(() => window.soundCues()), duration));
    // Voice: low rumble cut and light noise reduction; effects sit well under it. The mix is measured once, then levelled
    // linearly to YouTube's -14 LUFS; a limiter first keeps enough peak headroom for that gain.
    const chain = "[0:a]highpass=f=70,afftdn=nf=-30[v];[1:a]lowpass=f=3000,volume=0.4[e];[v][e]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.5:level=false";
    const measured = spawnSync("ffmpeg", ["-hide_banner", "-i", args.audio, "-i", effects, "-filter_complex", `${chain},loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"],
      { encoding: "utf8" }).stderr;
    const m = JSON.parse(measured.slice(measured.lastIndexOf("{"), measured.lastIndexOf("}") + 1));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", args.audio, "-i", effects, "-filter_complex",
      `${chain},loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`, mixed]);
    const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "pipe:0", "-i", mixed,
      "-map", "0:v", "-map", "1:a",
      "-t", String(duration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", args.output], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((resolve, reject) => ffmpeg.on("close", (code) => code ? reject(new Error("Video encoder failed")) : resolve()));
    for (let frame = 0; frame < Math.ceil(duration * fps); frame++) {
      await page.evaluate((t) => window.render(t), frame / fps);
      if (!ffmpeg.stdin.write(await page.screenshot({ type: "jpeg", quality: 95 }))) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    }
    ffmpeg.stdin.end();
    await done;
    console.log(args.output);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
