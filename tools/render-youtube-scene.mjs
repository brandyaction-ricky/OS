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
import { spawn, execFileSync } from "node:child_process";
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
// Pretendard (OFL-1.1) renders identically on macOS and the Linux media worker.
const FONTS = {
  600: ["https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-SemiBold.woff2", "c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0"],
  800: ["https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-ExtraBold.woff2", "dd7c1e156f508eb962acc7a33a7a1896d1e0b71e11156fad96e731689ceb6dc3"],
};

async function fontFaces() {
  const faces = [];
  for (const [weight, [url, digest]] of Object.entries(FONTS)) {
    const cached = path.join(os.tmpdir(), `brandyaction-${digest}.woff2`);
    let bytes = existsSync(cached) ? readFileSync(cached) : Buffer.from(await (await fetch(url)).arrayBuffer());
    if (sha256(bytes) !== digest) fail(`Font checksum changed: ${url}`);
    writeFileSync(cached, bytes);
    faces.push(`@font-face{font-family:"Pretendard";font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")}`);
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

export function pageHtml(beats, characters, faces, captions = []) {
  const style = `.i{stroke:${C.ink};stroke-width:4;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .r{stroke:${C.red};stroke-width:4;fill:none;stroke-linecap:round;stroke-linejoin:round} .thin{stroke-width:3} .bold{stroke-width:6} .p{fill:${C.pale}}
    text{font-family:"Pretendard";font-weight:600;fill:${C.ink};text-anchor:middle;dominant-baseline:middle;stroke:none}
    .lab{font-size:30px} .sm{font-size:26px;fill:${C.muted};font-weight:600} .acc{fill:${C.red};font-weight:800} .muted{fill:${C.muted}}
    .b7{font-weight:700} .b8{font-weight:800} .start{text-anchor:start} .end{text-anchor:end}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
  html,body{margin:0;width:${W}px;height:${H}px;background:${C.paper};overflow:hidden}
  #title{position:absolute;left:0;right:0;top:92px;text-align:center;font:800 52px "Pretendard";color:${C.ink};letter-spacing:-1px;white-space:nowrap}
  #title b{color:${C.red};font-weight:800} svg{position:absolute;inset:0}
  #cap{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);max-width:1100px;padding:10px 26px;border-radius:12px;
    background:${C.ink};color:#fff;font:700 34px "Pretendard";letter-spacing:-.5px;white-space:nowrap;z-index:2;display:none}</style></head><body><div id="title"></div><div id="cap"></div>
  ${beats.map((beat, i) => `<svg id="b${i}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:none"><style>${style}</style>
    <defs><filter id="line${i}"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 1 1 1"/><feFuncG type="discrete" tableValues="0 1 1 1"/><feFuncB type="discrete" tableValues="0 1 1 1"/></feComponentTransfer></filter></defs>
    ${beat.svg.replace(/<image data-character="([a-z0-9_-]+)"/g, (_, id) => `<image href="${characters.get(id)}" preserveAspectRatio="xMidYMid meet" data-character="${id}"`)}</svg>`).join("")}
  <script>
  const beats = ${JSON.stringify(beats.map((beat) => ({ ...beat, svg: undefined })))};
  const captions = ${JSON.stringify(captions)};
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
  // After fonts load: draw emphasis from measured text and centre each scene in the safe area.
  window.layoutBeats = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const add = (svg, tag, attrs, after) => { const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); after.after(el);
      if (attrs['data-k'] === 'draw') { el.setAttribute('pathLength', 1); el.style.strokeDasharray = 1; } return el; };
    document.querySelectorAll('svg[id^="b"]').forEach((svg, i) => {
      // A scene without a headline is centred in the whole frame; with one, below the headline band.
      const titled = Boolean(beats[i].displayText), top = titled ? ${SAFE.y1} : 60, mid = titled ? ${(SAFE.y1 + SAFE.y2) / 2} : 360;
      svg.style.display = '';
      svg.querySelectorAll('.ul').forEach(el => { const b = el.getBBox(), host = el.closest('text'), y = b.y + b.height + 6;
        add(svg, 'path', { class: 'r bold', d: 'M' + b.x + ' ' + y + 'H' + (b.x + b.width), 'data-k': 'draw', 'data-g': host.dataset.g || 0, 'data-s': (+host.dataset.s || 0) + .45, 'data-d': .35 }, host); });
      svg.querySelectorAll('text.ring').forEach(el => { const b = el.getBBox();
        add(svg, 'ellipse', { class: 'r', cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2 + 34, ry: b.height / 2 + 16, 'data-k': 'draw', 'data-g': el.dataset.g || 0, 'data-s': (+el.dataset.s || 0) + .4, 'data-d': .4 }, el); });
      const group = document.createElementNS(ns, 'g');
      [...svg.childNodes].filter(n => !['style', 'defs'].includes(n.nodeName)).forEach(n => group.appendChild(n));
      svg.appendChild(group);
      const b = group.getBBox();
      if (b.width && b.height) {
        const dx = Math.max(${SAFE.x1} - b.x, Math.min(${SAFE.x2} - b.x - b.width, 640 - (b.x + b.width / 2)));
        const dy = Math.max(top - b.y, Math.min(${SAFE.y2 - 70} - b.y - b.height, mid - (b.y + b.height / 2)));
        group.setAttribute('transform', 'translate(' + dx.toFixed(1) + ' ' + dy.toFixed(1) + ')');
      }
      svg.style.display = 'none';
    });
  };
  window.render = t => {
    const active = beats.findIndex(b => b.visualStartSeconds <= t && t < b.endSeconds);
    beats.forEach((b, i) => document.getElementById('b' + i).style.display = i === active ? '' : 'none');
    const title = document.getElementById('title');
    if (active < 0) { title.innerHTML = ''; return; }
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
    if (b.typographyStartSeconds !== null && t >= b.typographyStartSeconds) {
      const o = ease((t - b.typographyStartSeconds) / .24);
      const esc = v => v.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      title.innerHTML = b.accentText ? esc(b.displayText).replace(esc(b.accentText), '<b>' + esc(b.accentText) + '</b>') : esc(b.displayText);
      title.style.opacity = o; title.style.transform = 'translateY(' + (1 - o) * 12 + 'px)';
    } else title.innerHTML = '';
    const cap = document.getElementById('cap'), line = captions.find(c => c.startSeconds <= t && t < c.endSeconds && !c.hidden);
    cap.textContent = line ? line.text : ''; cap.style.display = line ? 'block' : 'none';
  };
  // Final-state geometry: safe area, text collisions, text over artwork, title width.
  window.inspectBeat = i => {
    const b = beats[i]; window.render(b.endSeconds - 0.001);
    const problems = [], box = el => el.getBoundingClientRect();
    const svg = document.getElementById('b' + i), items = [...svg.querySelectorAll('[data-k]')].filter(el => el.tagName !== 'g');
    for (const el of items) { const r = box(el);
      if (r.width && (r.left < ${SAFE.x1} - 1 || r.right > ${SAFE.x2} + 1 || r.top < (b.displayText ? ${SAFE.y1} : 60) - 1 || r.bottom > ${SAFE.y2} + 1))
        problems.push(el.tagName + ' outside safe area'); }
    const texts = [...svg.querySelectorAll('text')].map(box), art = [...svg.querySelectorAll('image[data-k]')].map(box);
    const hit = (a, c, pad) => a.left < c.right + pad && c.left < a.right + pad && a.top < c.bottom + pad && c.top < a.bottom + pad;
    texts.forEach((a, m) => texts.slice(m + 1).forEach(c => { if (hit(a, c, 4)) problems.push('labels overlap'); }));
    texts.forEach(a => art.forEach(c => { if (hit(a, c, 0)) problems.push('label covers character'); }));
    const range = document.createRange(); range.selectNodeContents(document.getElementById('title'));
    if (range.getBoundingClientRect().width > 1040) problems.push('title too wide');
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
    await page.setContent(pageHtml(beats, characters, await fontFaces(), captions), { waitUntil: "load" });
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
    const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "pipe:0", "-i", args.audio,
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
