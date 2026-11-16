import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 로건 11-16: he edited the script and pressed 음성 만들기 again; the render PC kept making the old script's voice for an hour first.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("killTree stops a process and the processes it started", { skip: process.platform === "win32" }, async () => {
  const { killTree } = await import(`../tools/youtube-media-worker.mjs?stop=${Date.now()}`);
  const parent = spawn("sh", ["-c", "sleep 30 & echo $!; wait"], { stdio: ["ignore", "pipe", "ignore"] });
  const grandchild = Number(await new Promise((resolve) => parent.stdout.once("data", (chunk) => resolve(String(chunk).trim()))));
  const exited = new Promise((resolve) => parent.once("exit", resolve));
  killTree(parent.pid);
  await exited;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.throws(() => process.kill(grandchild, 0), /ESRCH/);
});

test("the heartbeat tells the render PC to stop a run a newer run of the same video replaced", () => {
  const pc = read("lib/server/youtube-render-pc.ts");
  assert.match(pc, /runId: z\.string\(\)\.uuid\(\)\.optional\(\), step: z\.string\(\)/);
  const route = read("app/api/v1/content/youtube-automation/media/route.ts");
  assert.match(route, /input\.job\?\.runId && await myinRunReplaced\(input\.job\.runId\) \? \{ stopRun: input\.job\.runId \}/);
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /export async function myinRunReplaced[\s\S]{0,600}\.eq\("metadata->>kind", MYIN_RUN_KIND\)\s*\.is\("archived_at", null\)\.gt\("created_at", run\.created_at\)/);
  // The stopped run fails as stale, which stops it instead of putting it back in the queue (the oldest run is claimed first).
  assert.match(run, /const final = code === "MYIN_RUN_STALE"/);
});

test("the render PC names the v13 run it works on and stops its processes when told", () => {
  const worker = read("tools/youtube-media-worker.mjs");
  assert.equal(worker.match(/current = \{ step: "(download|drawing)", runId: job\.runId \}/g)?.length, 5);
  assert.match(worker, /answer\?\.stopRun && answer\.stopRun === current\?\.runId[\s\S]{0,200}for \(const child of children\)[^\n]*killTree\(child\.pid\)/);
  assert.match(worker, /const runAsync = [^\n]*\n  if \(isStopping\(\)\) return reject\(staleError\(\)\);/);
  assert.match(worker, /reject\(isStopping\(\) \? staleError\(\) :/);
  assert.match(worker, /const runOut = [^\n]*\n  if \(isStopping\(\)\) return resolve\(\{ ok: false, out: "" \}\);/);
  assert.match(worker, /code: "MYIN_RUN_STALE"/);
});
