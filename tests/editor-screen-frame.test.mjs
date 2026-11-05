import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { editorScreenDoc } from "../lib/editor-screen-doc.ts";

// 편집 화면 이식 ② (2026-11-05): the editor screen runs as it is in a sandboxed frame; its asks to its own computer's server go to the OS page.
const shim = readFileSync(new URL("../public/editor-screen-shim.js", import.meta.url), "utf8");
const S3 = "https://store.example.co/storage/v1/object/sign";
const SAY = "66666666-6666-4666-8666-666666666666";

function frame(answers) {
  const sent = [], told = [], listeners = [];
  const urls = {
    [`${S3}/v1/version.json?token=a`]: JSON.stringify({ end: 30, scenes: [{ i: 0, a: 0, b: 30, g: "photo", label: "x", type: "x", thumb: "thumb-s00.jpg" }], changed: [] }),
    [`${S3}/v1/subs.json?token=a`]: JSON.stringify({ rows: [{ a: 1, b: 2, png: "sub-0001.png" }] }),
    [`${S3}/v1/subs.srt?token=a`]: "1\n00:00:01,500 --> 00:00:03,000\n첫 줄\n\n2\n00:01:00,000 --> 00:01:02,250\n둘째\n줄\n",
  };
  const fetched = [];
  class Media { constructor() { this._src = ""; } }
  Object.defineProperty(Media.prototype, "src", { configurable: true, get() { return this._src; }, set(v) { this._src = v; } });
  class Audio extends Media {}
  class Anchor { constructor(href) { this.href = href; this.native = 0; } getAttribute() { return this.href; } click() { this.native += 1; } }
  const w = {
    parent: { postMessage: (d) => { if (d.id === undefined) { told.push(d); return; } sent.push(d);
      Promise.resolve(answers[d.op] ? answers[d.op](d.body) : { ok: true }).then((result) => listeners.forEach((f) => f({ source: w.parent, data: { os: "editor", id: d.id, result } })),
        (e) => listeners.forEach((f) => f({ source: w.parent, data: { os: "editor", id: d.id, error: e.message, status: 409 } }))); } },
    fetch: async (u) => { fetched.push(u); return urls[u] ? new Response(urls[u]) : new Response("", { status: 404 }); },
    addEventListener: (type, f) => { if (type === "message") listeners.push(f); },
    HTMLMediaElement: Media, Audio, HTMLAnchorElement: Anchor, __osEditorStore: { zoom: "3" },
  };
  Object.defineProperty(w, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  w.window = w;
  vm.runInNewContext(shim, { window: w, Response, Blob, URL, JSON, Promise, Object, Error, Math, Date, Number, String, WeakMap, Map, Array });
  return { w, sent, told, fetched, Audio, Anchor, Media };
}
const STATE = () => ({ now: 100, versions: [{ name: "v1", at: "2026-11-05T09:00:00.000Z", files: 4, bytes: 9 }], saves: { list: [], pending: null }, edits: [], orders: [], jobs: {}, stats: {}, where: {}, build: null });
const FILES = { files: { "version.json": `${S3}/v1/version.json?token=a`, "video.mp4": `${S3}/v1/video.mp4?token=a`, "voice.m4a": `${S3}/v1/voice.m4a?token=a`,
  "thumb-s00.jpg": `${S3}/v1/thumb-s00.jpg?token=a`, "subs.srt": `${S3}/v1/subs.srt?token=a`, "subs.json": `${S3}/v1/subs.json?token=a`, "sub-0001.png": `${S3}/v1/sub-0001.png?token=a` } };
const json = async (w, path, init) => (await w.fetch(path, init)).json();

test("the screen's state comes from the OS: each version is its own version.json, its pictures at OS addresses", async () => {
  const { w, sent } = frame({ state: STATE, files: () => FILES });
  const s = await json(w, "/api/state", { cache: "no-store" });
  assert.equal(s.versions[0].name, "v1");
  assert.equal(s.versions[0].end, 30);
  assert.equal(s.versions[0].scenes[0].thumb, FILES.files["thumb-s00.jpg"], "a picture named by file name plays from OS storage");
  assert.deepEqual(s.versions[0].music, [], "a version without music lines still draws");
  await json(w, "/api/state");
  assert.equal(sent.filter((d) => d.op === "state").length, 1, "the 1.5 s poll asks the OS every 4 s at most");
  assert.equal(sent.filter((d) => d.op === "files").length, 1, "a version's files are asked once");
});

test("video and sound play from the version's files; the screen reads back the path it set", async () => {
  const { w, Audio } = frame({ state: STATE, files: () => FILES });
  await json(w, "/api/state");
  const video = new w.HTMLMediaElement();
  video.src = "/video/v1.mp4";
  assert.equal(video._src, FILES.files["video.mp4"]);
  assert.equal(video.src, "/video/v1.mp4", "its own `src.endsWith(…)` checks keep working (else it reloads the video every frame)");
  const sound = new w.Audio("/stem/v1_voice.wav");
  assert.ok(sound instanceof Audio && sound._src === FILES.files["voice.m4a"]);
  const later = new w.HTMLMediaElement();
  later.src = "/live/c01.mp4";
  assert.equal(later._src, "", "the screen's 만드는 중 view is not in the OS");
  const layer = await json(w, `${FILES.files["subs.json"]}?r=5`);
  assert.equal(layer.rows[0].png, FILES.files["sub-0001.png"], "the subtitle layer's pictures, named in its own JSON, come from OS storage");
});

test("subtitles, hand edits, 완성 and the chat line", async () => {
  const edits = [];
  const { w, sent } = frame({ state: STATE, files: () => FILES, edit: (b) => { edits.push(b); return { id: "o-1" }; }, save: () => ({ ok: true, label: "v2", waiting: 1 }) });
  assert.deepEqual(await json(w, "/api/subs/v1"), [[1.5, 3, "첫 줄"], [60, 62.25, "둘째 줄"]]);
  await json(w, "/api/state");
  const r = await json(w, "/api/edit", { method: "POST", body: JSON.stringify({ version: "v1", text: "[손으로] 끝 당기기", manual: { kind: "trim", from: 3, to: 2.5 } }) });
  assert.equal(r.id, "o-1");
  await json(w, "/api/order", { method: "POST", body: JSON.stringify({ version: "v1", text: "자막", manual: { kind: "subs", edits: [] } }) });
  assert.deepEqual(edits.map((e) => e.manual.kind), ["trim", "subs"], "자막 확정 is a hand edit too");
  await json(w, "/api/state");
  assert.equal(sent.filter((d) => d.op === "state").length, 2, "after a change the next poll asks the OS at once");
  const memo = await w.fetch("/api/order", { method: "POST", body: JSON.stringify({ text: "1:02 너무 빨라", at: 62 }) });
  assert.equal(memo.status, 400);
  assert.match((await memo.json()).error, /AI 채팅/);
  assert.deepEqual(await json(w, "/api/save", { method: "POST" }), { ok: true, label: "v2", waiting: 1 });
  assert.equal((await w.fetch("/api/scenekit/swap", { method: "POST", body: "{}" })).status, 404, "its own computer's extras answer plainly");
});

test("a sentence read again: takes named as the screen names them, played from the OS", async () => {
  const { w } = frame({ say: () => ({ id: SAY }), say_status: () => ({ status: "done", sentences: ["다시 읽기"], takes: [{ i: 0, k: 0, rise: 1.2, url: "https://store.example.co/t0" }, { i: 0, k: 1, rise: 0.4, url: "https://store.example.co/t1" }] }) });
  assert.deepEqual(await json(w, "/api/say", { method: "POST", body: JSON.stringify({ text: "다시 읽기" }) }), { id: SAY });
  const st = await json(w, `/api/say/${SAY}`);
  assert.equal(st.ready, true);
  assert.equal(st.best, `${SAY}_0.wav`);
  assert.equal(st.takes[1].file.replace(/_\d+\.wav$/, ""), SAY, "the take picker finds its request from a take's name");
  assert.equal(new w.Audio(`/newline/${SAY}_1.wav`)._src, "https://store.example.co/t1");
});

test("no storage of its own, a signed address keeps its token, 완성's download shows the OS final", async () => {
  const { w, told, fetched, Anchor } = frame({});
  assert.equal(w.localStorage.getItem("zoom"), "3");
  w.localStorage.setItem("keysHint", "1");
  assert.deepEqual(JSON.parse(JSON.stringify(told.at(-1))), { os: "editor", op: "store", body: { key: "keysHint", value: "1" } });
  await w.fetch(`${S3}/v1/wave.json?token=a?r=123`);
  assert.equal(fetched.at(-1), `${S3}/v1/wave.json?token=a`);
  const link = new Anchor("/api/export/v7/file/final");
  link.click();
  assert.equal(link.native, 0);
  assert.equal(told.at(-1).op, "final");
});

test("the frame's page: the screen's scripts inline, a missing one left out, the OS rules first", () => {
  const doc = editorScreenDoc({ "index.html": `<html><head><title>x</title></head><body><script src="trim.js?v=11"></script><script src="soundkit.js?v=1"></script></body></html>`,
    "trim.js": `const end = "</script>";` }, { origin: "https://os.example", storage: "https://store.example.co", store: { a: "</script>" } });
  assert.match(doc, /^<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:\/\/os\.example;/);
  assert.match(doc, /connect-src https:\/\/store\.example\.co"/);
  assert.match(doc, /<script>const end = "<\\\/script>";<\/script><\/body>/, "a script's own </script> cannot end it early");
  assert.ok(!doc.includes("soundkit"));
  assert.ok(doc.indexOf("editor-screen-shim.js") < doc.indexOf("const end"), "the bridge runs before the screen");
  assert.ok(doc.includes('window.__osEditorStore={"a":"\\u003c/script>"}'));
  assert.equal(editorScreenDoc({ "trim.js": "" }, { origin: "https://os.example", storage: "https://store.example.co", store: {} }), null);
});

test("the server: the screen's maker puts it up for everyone, staff read it, the frame cannot sign in", () => {
  const edit = readFileSync(new URL("../lib/server/myin-edit.ts", import.meta.url), "utf8");
  assert.match(edit, /export async function publishScreenCode/);
  assert.match(edit.slice(edit.indexOf("export async function screenCode")), /await editorProject\(actor, projectId\)/);
  assert.match(edit, /createSignedUrls\(names\.map\(\(name\) => `\$\{dir\}\/\$\{name\}`\), 21_600\)/, "an edit video's address lasts an editing afternoon");
  const route = readFileSync(new URL("../app/api/v1/content/youtube-automation/editor/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf('body?.action === "screen_publish"') < route.indexOf("postSchema.parse(body)"), "a screen is put up for no one video");
  const entry = readFileSync(new URL("../components/editor-screen.tsx", import.meta.url), "utf8");
  assert.match(entry, /sandbox="allow-scripts allow-modals"/, "never allow-same-origin: the frame would reach the OS sign-in");
  assert.match(entry, /event\.source !== win/);
});
