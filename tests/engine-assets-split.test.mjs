import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 엔진 · 자료 분리 (로건 개발 문서 v3 7.2-13): the engine's assets travel once per their fingerprint; each engine gets its own real folder.
const tar = (dir) => { const file = path.join(mkdtempSync(path.join(os.tmpdir(), "tar-")), "b.tar.gz"); assert.equal(spawnSync("tar", ["-czf", file, "-C", dir, "."]).status, 0); return readFileSync(file); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

test("a split engine installs its code, links its assets from one shared store, and never writes into that store", { skip: spawnSync("python3", ["-V"]).status !== 0 }, async () => {
  const afp = "c".repeat(64);
  const assetsSrc = mkdtempSync(path.join(os.tmpdir(), "assets-src-"));
  mkdirSync(path.join(assetsSrc, "assets", "bgm"), { recursive: true }); writeFileSync(path.join(assetsSrc, "assets", "bgm", "song.mp3"), "music");
  const code = (fp) => {
    const src = mkdtempSync(path.join(os.tmpdir(), "code-src-"));
    mkdirSync(path.join(src, "engine", "pkg", "tools"), { recursive: true }); mkdirSync(path.join(src, "tools"), { recursive: true });
    writeFileSync(path.join(src, "tools", "youtube-media-worker.mjs"), "process.exit(0)\n");
    writeFileSync(path.join(src, "requirements.lock"), ""); writeFileSync(path.join(src, "FINGERPRINT"), `${fp}\n`); writeFileSync(path.join(src, "ASSETS"), `${afp}\n`);
    return tar(src);
  };
  const files = { a: code("a".repeat(32)), b: code("b".repeat(32)), assets: tar(assetsSrc) };
  let assetFetches = 0;
  const server = createServer((request, response) => { const key = request.url.slice(1); if (key === "assets") assetFetches += 1; response.end(files[key]); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const info = (fp, key) => ({ fingerprint: fp, python: "3.9", parts: [{ url: `${base}/${key}`, bytes: files[key].length, sha256: sha(files[key]) }],
    assets: { fingerprint: afp, parts: [{ url: `${base}/assets`, bytes: files.assets.length, sha256: sha(files.assets) }] } });
  try {
    process.env.MYIN_LOCAL_PYTHON = "python3";
    const runner = await import(`../public/myin-local/myin-local.mjs?split=${Math.random()}`);
    const home = mkdtempSync(path.join(os.tmpdir(), "myin-home-"));
    const one = await runner.installEngine(info("a".repeat(32), "a"), home);
    const own = path.join(one.dir, "engine", "pkg", "assets");
    assert.equal(readFileSync(path.join(own, "bgm", "song.mp3"), "utf8"), "music");
    assert.ok(!lstatSync(own).isSymbolicLink(), "a real folder: a video's downloads stay in the engine, not the store");
    const store = path.join(home, `assets-${afp}`);
    assert.equal(statSync(path.join(own, "bgm", "song.mp3")).ino, statSync(path.join(store, "assets", "bgm", "song.mp3")).ino, "hard links: no extra disk");
    writeFileSync(path.join(own, "bgm", "fetched.jpg"), "photo");
    assert.equal(existsSync(path.join(store, "assets", "bgm", "fetched.jpg")), false);
    await runner.installEngine(info("b".repeat(32), "b"), home);
    assert.equal(assetFetches, 1, "the same assets are downloaded once");
    mkdirSync(path.join(home, `assets-${"d".repeat(64)}`));
    await runner.installEngine(info("b".repeat(32), "b"), home);
    assert.ok(readdirSync(home).includes(`assets-${afp}`) && !readdirSync(home).includes(`assets-${"d".repeat(64)}`), "assets no engine names are removed");
  } finally { server.close(); delete process.env.MYIN_LOCAL_PYTHON; }
});

test("the OS hands a split engine only to a runner that asks for it; the render PC uploads assets once, before the engine", () => {
  const engine = readFileSync(new URL("../lib/server/render-engine.ts", import.meta.url), "utf8");
  assert.match(engine, /if \(!split\) return \{ fingerprint: manifest\.fingerprint, available: false as const, update: true as const \};/);
  assert.match(engine, /if \(await readAssets\(input\.fingerprint\)\) return \{ have: true, urls: \[\] as string\[\] \};/);
  const local = readFileSync(new URL("../app/api/v1/content/youtube-automation/local-render/route.ts", import.meta.url), "utf8");
  assert.match(local, /currentEngineDownload\(await renderPcEngine\(\), Boolean\(input\.split\)\)/);
  const runner = readFileSync(new URL("../public/myin-local/myin-local.mjs", import.meta.url), "utf8");
  assert.match(runner, /api\(key, \{ action: "engine", split: true \}\)/);
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  const publish = worker.slice(worker.indexOf("export async function publishEngine"), worker.indexOf("async function uploadParts"));
  assert.ok(publish.indexOf("assets_ready") < publish.indexOf("engine_ready"), "the assets are kept before the engine that names them");
  assert.match(publish, /if \(!answer\.have\)/);
  const pack = readFileSync(new URL("../tools/myin-engine-pack.sh", import.meta.url), "utf8");
  assert.match(pack, /--exclude \/assets --exclude \/voice/, "no assets in the code bundle, and never his sample voices");
  assert.match(pack, /echo "ASSETS=\$AFP"; echo "ASSETS_BUNDLE=\$ABUNDLE"/);
  const ps = readFileSync(new URL("../public/myin-local/install.ps1", import.meta.url), "utf8");
  assert.match(ps, /curl\.exe -fsSL `"\$OsUrl\/myin-local\/myin-local\.mjs`"/, "the Windows launcher takes the latest runner each start");
});
