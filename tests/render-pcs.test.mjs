import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import { movePinned, pinnedElsewhere } from "../lib/myin-local.ts";

// 렌더 PC 여러 대 (owner decision 2026-10-27, set up 2026-11-08): the OS gives each video to one render PC by itself, the video stays
// with the PC holding its work folder, and a PC that went away hands its videos on.
test("a video waits for its render PC and moves on only when that PC has been off and its voice is in the OS", () => {
  assert.equal(pinnedElsewhere({}, "mini-2"), false, "a video no PC holds yet goes to any PC");
  assert.equal(pinnedElsewhere({ pc: "mini-2" }, "mini-2"), false);
  assert.equal(pinnedElsewhere({ pc: "mini-2" }, "air-1"), true);
  assert.equal(pinnedElsewhere({ pc: "mini-2" }, undefined), true, "a worker without a name takes only videos no PC holds");
  const voiced = { words: { voice: { path: "x" } } };
  for (const stage of ["words_pending", "cta_pending", "prep_pending", "clips_pending", "final_pending"]) assert.equal(movePinned(stage, voiced, false), "wait", stage);
  assert.equal(movePinned("prep_pending", voiced, true), "take", "the next PC rebuilds stage 1 from the OS and prepares");
  assert.equal(movePinned("cta_pending", voiced, true), "take");
  assert.equal(movePinned("clips_pending", voiced, true), "prepare_again", "drafts need the ④ files the gone PC made");
  assert.equal(movePinned("final_pending", voiced, true), "prepare_again");
  assert.equal(movePinned("prep_pending", { words: {} }, true), "wait", "no voice in the OS: nothing to rebuild from");
  assert.equal(movePinned("words_pending", {}, true), "take", "the voice stage starts from the script");
});

async function loadRenderPc(objects) {
  const compiled = { exports: {} };
  const source = await readFile(new URL("../lib/server/youtube-render-pc.ts", import.meta.url), "utf8");
  const storage = {
    async upload(path, blob) { objects.set(path, JSON.parse(await blob.text())); return { error: null }; },
    async download(path) { return objects.has(path) ? { data: new Blob([JSON.stringify(objects.get(path))]), error: null } : { data: null, error: { message: "missing" } }; },
    async list(prefix) { return { data: [...objects.keys()].filter((key) => key.startsWith(`${prefix}/`)).map((key) => ({ name: key.slice(prefix.length + 1) })), error: null }; },
  };
  const query = { select: () => query, eq: () => query, in: () => query, is: () => query, order: () => query, limit: () => query, then: (resolve) => resolve({ data: [] }) };
  const modules = { zod, "@/lib/http": { ApiError: class extends Error {} }, "@/lib/supabase/server": { createServiceSupabase: () => ({ storage: { from: () => storage }, from: () => query }) },
    "./render-engine": { engineBundleSaved: async () => true }, "./youtube-render-run": { YOUTUBE_RENDER_RUN_KIND: "render" },
    "./youtube-voice-run": { YOUTUBE_VOICE_RUN_KIND: "voice", YOUTUBE_VOICE_TIMING_BUCKET: "timing" } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, Blob, require: (name) => { assert.ok(name in modules, name); return modules[name]; } });
  return compiled.exports;
}
const beat = (pc, engine) => ({ action: "heartbeat", diskFreeGb: 200, memUsedGb: 4, memTotalGb: 16, job: null, engine, ...(pc ? { pc } : {}) });
const signal = (engine, minutesAgo) => ({ diskFreeGb: 200, memUsedGb: 4, memTotalGb: 16, job: null, engine, at: new Date(Date.now() - minutesAgo * 60_000).toISOString() });

test("each render PC reports in its own file, and a PC with another engine takes no work", async () => {
  const objects = new Map([["render-pc/status.json", signal("c".repeat(16), 0)]]);
  const pc = await loadRenderPc(objects);
  const a = "a".repeat(16), b = "b".repeat(16);
  assert.equal(await pc.renderPcEngine(), "c".repeat(16), "one PC without a name keeps working as before");
  assert.deepEqual({ ...await pc.saveRenderPcSignal(beat("mini-office", a)) }, { ok: true, acceptsWork: true, engineBundle: true });
  assert.equal(await pc.renderPcEngine(), a, "once a PC reports a name, the old single file is no longer read");
  await pc.saveRenderPcSignal(beat("mini-2", a));
  const odd = await pc.saveRenderPcSignal(beat("air-1", b));
  assert.equal(odd.acceptsWork, false);
  assert.equal(odd.engineHeld, true);
  assert.equal(await pc.renderPcEngine(), a, "staff PCs match the engine most render PCs run");
  // A PC that joins on another engine never holds the one already at work, even one to one (whatever the hashes' order).
  const longAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const joins = new Map([["render-pc/pcs/mini-office.json", { ...signal(b, 0), since: longAgo }]]);
  const fresh = await loadRenderPc(joins);
  assert.equal((await fresh.saveRenderPcSignal(beat("air-2", a))).engineHeld, true, "the newcomer waits, though its hash sorts first");
  assert.equal((await fresh.saveRenderPcSignal(beat("mini-office", b))).acceptsWork, true);
  assert.equal(joins.get("render-pc/pcs/mini-office.json").since, longAgo, "kept while the engine stays");
  objects.set("render-pc/pcs/mini-2.json", signal(a, 31));
  assert.equal(await pc.renderPcGone("mini-2"), true, "off for more than half an hour");
  assert.equal(await pc.renderPcGone("mini-office"), false);
  assert.equal(await pc.renderPcGone("never-seen"), true);
  const status = await pc.readRenderPcStatus();
  assert.equal(status.state, "online");
  assert.deepEqual(JSON.parse(JSON.stringify(status.pcs.map(({ name, state, engineDifferent }) => [name, state, engineDifferent]))),
    [["air-1", "online", true], ["mini-2", "offline", false], ["mini-office", "online", false]]);
  assert.equal(pc.renderPcSignalSchema.safeParse(beat("../status", a)).success, false, "a name is never a path");
});

test("claims carry the PC's name, the run keeps it, and a PC without the folder prepares again", async () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const [run, media, worker, panel] = await Promise.all([read("lib/server/myin-run.ts"), read("app/api/v1/content/youtube-automation/media/route.ts"),
    read("tools/youtube-media-worker.mjs"), read("components/myin-v13-panel.tsx")]);
  const section = (from, to) => { const start = run.indexOf(from); assert.ok(start >= 0, from); return run.slice(start, run.indexOf(to, start)); };
  assert.match(section("async function claim(", "async function prepareAgain"), /if \(pc\) \{ if \(pc\.name\) next\.pc = pc\.name; else delete next\.pc; \}/);
  for (const [fn, end] of [["claimMyinWords", "async function leased"], ["claimMyinCta", "export async function completeMyinCta"]])
    assert.match(section(`export async function ${fn}`, end), /\{ name: pc \}\)/, fn);
  for (const [fn, end] of [["claimMyinPrep", "/** Render PC: the preview ran."], ["claimMyinClips", "export async function completeMyinClips"], ["claimMyinFinal", "export async function completeMyinFinal"]])
    assert.match(section(`export async function ${fn}`, end), /owner \? undefined : \{ name: pc \}\)/, `${fn}: a member's own computer is never pinned`);
  assert.match(section("export async function claimMyinPrep", "/** Render PC: the preview ran."), /owner \? \{ seed: await localSeed\(service, run\) \} : await seedFor\(service, run\)/);
  assert.match(section("export async function claimMyinCta", "export async function completeMyinCta"), /\.\.\.await seedFor\(service, run\)/);
  assert.doesNotMatch(section("export async function claimMyinClips", "export async function completeMyinClips"), /seedFor/, "drafts are never drawn from a rebuilt folder without ④ files");
  assert.match(section("async function prepareAgain", "async function failed"), /delete next\.pc;/);
  assert.match(run, /run\.layout \|\| run\.resumeFinal \? "final_pending" : "prep_ready";\n  delete next\.resumeFinal;/, "a full video already asked for starts after ④ on the next PC");
  assert.match(section("export async function failMyinStage", "/**"), /input\.code === "MYIN_WORK_MISSING" && !localOwner\(run\) && run\.words\?\.voice/);
  assert.equal((media.match(/short: z\.literal\(true\)\.optional\(\), pc(, stills: z\.literal\(true\)\.optional\(\))? \}\)\.strict\(\)/g) ?? []).length, 6, "every v13 render-PC claim takes the name");
  assert.equal((worker.match(/\.\.\.shortClaim, \.\.\.pcField/g) ?? []).length, 6, "the worker sends its name on every v13 claim");
  assert.match(worker, /\.\.\.\(engine\(\) \? \{ engine: engine\(\) \} : \{\}\), \.\.\.pcField \}\)/, "and on its heartbeat");
  assert.match(worker, /const worked = held \? false : await/, "a held PC takes no work");
  assert.match(worker, /export async function processMyinCta\(\) \{[\s\S]*?if \(job\.seed\) await myinRebuild\(job\.runId, job\.seed, job\.layout\);[\s\S]*?myinDirs\(job\.runId\)/);
  assert.match(worker, /copyEngine\(layout === "short" \? myinPkgShort : myinPkg, work\)/, "a moved 숏폼 is rebuilt from the vertical engine");
  assert.match(panel, /run\.pc \? `영상 만드는 컴퓨터\(\$\{run\.pc\}\)`/, "the screen says which PC has the video");
});
