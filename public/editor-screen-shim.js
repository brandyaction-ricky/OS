// 편집 화면 이식 ② (2026-11-05): the editor screen made on a member's computer runs as it is in a sandboxed frame in the OS 제작 tab.
// It asked its own computer's server (/api/state, /api/edit, /video/v3.mp4 …); here each ask goes to the OS page around the frame, which
// answers from the OS with the viewer's own sign-in (this frame never sees it). The editing computer puts each version's files up:
//   version.json   the version as the screen knows it (scenes, music, sfx, end, changed …); pictures in it named by file name
//   video.mp4      the edit video (no subtitles)          voice · music · sfx (.wav · .m4a · .mp3)   the sound lines
//   wave.json      the sound lines' peaks                 subs.srt                                   the subtitles
// The screen's own code can tell it is in the OS by window.OS_EDITOR.
(function (w) {
  "use strict";
  const up = w.parent;
  const realFetch = w.fetch.bind(w);
  w.OS_EDITOR = { inOs: true };

  let seq = 0;
  const waiting = new Map();
  const tell = (op, body) => up.postMessage({ os: "editor", op, body }, "*");
  const ask = (op, body) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, [ok, no]); up.postMessage({ os: "editor", id, op, body }, "*"); });
  w.addEventListener("message", (event) => {
    const d = event.source === up && event.data;
    if (!d || d.os !== "editor" || !waiting.has(d.id)) return;
    const [ok, no] = waiting.get(d.id); waiting.delete(d.id);
    if (d.error) no(Object.assign(new Error(d.error), { status: d.status || 500 })); else ok(d.result);
  });

  // A sandboxed frame has no storage of its own: the screen's few settings (zoom, hints seen) are kept by the OS page.
  const kept = Object.assign({}, w.__osEditorStore);
  const memory = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(kept, k) ? kept[k] : null),
    setItem: (k, v) => { kept[k] = String(v); tell("store", { key: String(k), value: String(v) }); },
    removeItem: (k) => { delete kept[k]; tell("store", { key: String(k), value: null }); },
    clear: () => undefined, key: (i) => Object.keys(kept)[i] ?? null, get length() { return Object.keys(kept).length; },
  };
  try { void w.localStorage.length; } catch { Object.defineProperty(w, "localStorage", { value: memory, configurable: true }); }

  // Each version's files, signed for six hours: asked again every five so a playing address never runs out.
  const EPOCH = 5 * 3600e3, epoch = () => Math.floor(Date.now() / EPOCH);
  const files = {}, versions = {}, takes = {}, folderOf = {};
  const filesOf = (name) => {
    const key = name + "@" + epoch();
    return files[key] || (files[key] = ask("files", { version: name }).then((r) => {
      for (const address of Object.values(r.files)) folderOf[address.split("?")[0]] = r.files;
      return r.files;
    }).catch((e) => { delete files[key]; throw e; }));
  };
  const known = {};   // the same maps, for the media addresses set at once
  const named = (map, value) => typeof value === "string" ? (map[value] || value) : Array.isArray(value) ? value.map((x) => named(map, x))
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, x]) => [k, named(map, x)])) : value;
  const versionOf = (v) => {
    const key = v.name + "@" + v.at + "@" + epoch();
    return versions[key] || (versions[key] = filesOf(v.name).then(async (map) => {
      known[v.name] = { at: epoch(), map };
      const own = await realFetch(map["version.json"]).then((r) => { if (!r.ok) throw new Error("version.json"); return r.json(); });
      return Object.assign({ scenes: [], music: [], sfx: [], changed: [], end: 0 }, named(map, own), { name: v.name, from: own.from ?? v.from ?? null, note: own.note ?? v.note ?? "" });
    }).catch((e) => { delete versions[key]; throw e; }));
  };

  // The screen polls every 1.5 s; the OS is asked every 4 s at most, and at once after a change.
  let last = null, lastAt = 0, pending = null;
  const state = () => {
    if (last && Date.now() - lastAt < 4000) return Promise.resolve(last);
    return pending || (pending = ask("state").then(async (s) => {
      s.versions = (await Promise.all(s.versions.map((v) => versionOf(v).catch(() => null)))).filter(Boolean);
      last = s; lastAt = Date.now(); return s;
    }).finally(() => { pending = null; }));
  };
  const changed = (p) => p.then((r) => { lastAt = 0; return r; });

  // A path the screen's own server served: which version's file it is.
  const local = (src) => typeof src === "string" && src.startsWith("/") && !src.startsWith("//") ? src.split("?")[0] : null;
  const SOUND = /^(voice|music|sfx)\.(wav|m4a|mp3)$/;
  const versionFile = (path) => {
    let m = path.match(/^\/video\/([A-Za-z0-9_-]+)\.mp4$/); if (m) return { version: m[1], is: (n) => n === "video.mp4" };
    m = path.match(/^\/stem\/([A-Za-z0-9_-]+)_(voice|music|sfx)\.wav$/); if (m) { const line = m[2]; return { version: m[1], is: (n) => SOUND.test(n) && n.startsWith(line + ".") }; }
    m = path.match(/^\/wave\/([A-Za-z0-9_-]+)\.json$/); if (m) return { version: m[1], is: (n) => n === "wave.json" };
    return null;
  };
  const take = (path) => { const m = path.match(/^\/newline\/([A-Za-z0-9_.-]+)$/); return m ? m[1] : null; };
  /** The address now, or undefined when it must be asked first. "" = not in the OS (the screen's 만드는 중 view). */
  const addressNow = (src) => {
    const path = local(src); if (path == null) return src;
    const at = versionFile(path);
    if (at) { const k = known[at.version]; if (!k || k.at !== epoch()) return undefined; const name = Object.keys(k.map).find(at.is); return name ? k.map[name] : ""; }
    const t = take(path);
    if (t) { const k = takes[t]; return k && Date.now() - k.at < 25 * 60e3 ? k.url : undefined; }
    return "";
  };
  const addressLater = async (src) => {
    const path = local(src); if (path == null) return src;
    const at = versionFile(path);
    if (at) { const map = await filesOf(at.version); known[at.version] = { at: epoch(), map }; const name = Object.keys(map).find(at.is); return name ? map[name] : ""; }
    const t = take(path);
    if (t) { await sayTakes(t.replace(/_\d+\.wav$/, "")); return takes[t] ? takes[t].url : ""; }
    return "";
  };
  // A signed address with the screen's own ?r=… after it would lose its token.
  const clean = (u) => { const i = u.indexOf("?"), j = i < 0 ? -1 : u.indexOf("?", i + 1); return j < 0 ? u : u.slice(0, j); };

  async function sayTakes(id) {
    const r = await ask("say_status", { id });
    if (r.status === "failed") return { ready: false, error: "Error: " + (r.error || "목소리를 만들지 못했어요") };
    if (r.status !== "done") return { ready: false, error: null };
    const list = r.takes.filter((t) => t.url).map((t) => { const file = id + "_" + t.k + ".wav"; takes[file] = { url: t.url, at: Date.now() }; return { file, rise: t.rise }; });
    return { ready: true, text: (r.sentences || [""])[0], best: list[0] ? list[0].file : null, takes: list };
  }
  async function subs(name) {
    const map = await filesOf(name);
    if (!map["subs.srt"]) return [];
    const text = await realFetch(map["subs.srt"]).then((r) => (r.ok ? r.text() : ""));
    const clock = (t) => t.trim().replace(",", ".").split(":").reduce((s, x) => s * 60 + Number(x), 0);
    return text.replace(/\r/g, "").trim().split(/\n\s*\n/).flatMap((block) => {
      const lines = block.trim().split("\n"); if (lines.length < 3) return [];
      const [a, b] = lines[1].split("-->").map(clock);
      return [[Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000, lines.slice(2).join(" ")]];
    });
  }

  const notHere = () => Object.assign(new Error("OS 편집 화면에서는 아직 못 쓰는 기능이에요."), { status: 404 });
  const parse = (raw) => { try { return typeof raw === "string" ? JSON.parse(raw) : {}; } catch { return {}; } };
  async function route(path, method, raw) {
    if (path === "/api/state") return state().then((s) => Object.assign({}, s, { now: s.now + (Date.now() - lastAt) / 1000 }));
    let m = path.match(/^\/api\/subs\/([A-Za-z0-9_-]+)$/);
    if (m) return subs(m[1]);
    m = path.match(/^\/api\/say\/([0-9a-f-]{36})$/);
    if (m) return sayTakes(m[1]);
    // 완성: the new final is in the OS's 최종본 list (made by the editing computer); nothing to download here.
    m = path.match(/^\/api\/export\/([A-Za-z0-9_-]+)$/);
    if (m && method === "GET") return { items: [{ key: "final", ready: true, make: false, file: "" }] };
    if (path === "/api/draft") return {};
    if (method !== "POST") throw notHere();
    const b = parse(raw);
    if (path === "/api/where") return { ok: true, pick: "mine" };
    // A hand edit (from the screen's 손 편집 or its 자막 확정) waits in the OS until 완성; a written order is said in the AI chat.
    if (path === "/api/edit" || (path === "/api/order" && b.manual)) return changed(ask("edit", { version: b.version, text: b.text, manual: b.manual }));
    if (path === "/api/order") throw Object.assign(new Error("OS에서는 이 내용을 연결된 AI 채팅에 말해 주세요."), { status: 400 });
    if (path === "/api/order_cancel") return changed(ask("cancel", { id: b.id }));
    if (path === "/api/save") return changed(ask("save"));
    if (path === "/api/base") return changed(ask("base", { version: b.version ?? null }));
    if (path === "/api/say") return ask("say", { text: b.text });
    if (path === "/api/upload_image") {
      if (!(raw instanceof Blob)) throw notHere();
      const r = await ask("image", { file: raw });
      return { file: r.file, url: URL.createObjectURL(raw) };
    }
    throw notHere();
  }

  const reply = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
  w.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const path = local(url);
    if (path == null) {
      // A version's own JSON (its subtitle layer, its peaks) names the files beside it: those come back at their OS addresses too.
      const address = clean(url), map = folderOf[address.split("?")[0]];
      if (!map || !/\.json$/.test(address.split("?")[0])) return realFetch(address, init);
      const r = await realFetch(address, init);
      return r.ok ? reply(named(map, await r.json())) : r;
    }
    try {
      if (versionFile(path)) { const address = await addressLater(path); return address ? realFetch(address) : reply({ error: "이 버전에 없는 파일이에요." }, 404); }
      return reply(await route(path, ((init && init.method) || "GET").toUpperCase(), init && init.body));
    } catch (e) { return reply({ ok: false, error: e.message || "OS에 닿지 않아요." }, e.status || 500); }
  };

  // Video and sound: the screen sets its server's paths; the element gets the OS address (it reads back what the screen set).
  const media = Object.getOwnPropertyDescriptor(w.HTMLMediaElement.prototype, "src");
  const given = new WeakMap();
  Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
    configurable: true, enumerable: true,
    get() { return given.has(this) ? given.get(this) : media.get.call(this); },
    set(value) {
      const src = String(value); given.set(this, src);
      const now = addressNow(src);
      if (now !== undefined) { media.set.call(this, now); return; }
      addressLater(src).then((address) => { if (given.get(this) === src) media.set.call(this, address); }, () => undefined);
    },
  });
  const NativeAudio = w.Audio;
  w.Audio = function Audio(src) { const a = new NativeAudio(); if (src !== undefined) a.src = src; return a; };
  w.Audio.prototype = NativeAudio.prototype;
  // 완성's download link (the subtitled final from its own server): the OS page shows the new final instead.
  const click = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () {
    const path = local(this.getAttribute("href"));
    if (path && path.startsWith("/api/export/")) { tell("final", {}); return; }
    return click.call(this);
  };
})(window);
