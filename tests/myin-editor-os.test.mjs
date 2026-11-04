import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 영상 편집기 ②-3 (로건 개발 문서 v2): the client Logan's editor uses in place of his testbed's sim_lib, checked against a fake OS.
const python = ["python3", "python"].find((name) => spawnSync(name, ["--version"]).status === 0);

test("the editor client locks, takes orders, confirms with its bundle and goes on elsewhere (fake OS)", { skip: !python && "no python" }, () => {
  const run = spawnSync(python, ["-I", "tools/myin_editor_os.py", "--self-test"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /self-test ok/);
});

test("it calls only the editor route, with the staff computer key, and holds the same check line as the OS", async () => {
  const source = await readFile(new URL("../tools/myin_editor_os.py", import.meta.url), "utf8");
  assert.match(source, /ROUTE = "\/api\/v1\/content\/youtube-automation\/editor"/);
  assert.match(source, /MYIN_LOCAL_KEY/);
  assert.doesNotMatch(source, /YOUTUBE_MEDIA_WORKER_SECRET/, "never the render PC's secret");
  const os = await readFile(new URL("../lib/myin-edit.ts", import.meta.url), "utf8");
  for (const line of ["Math.abs(c.frames - want) > 1", "1.5 / EDIT_FPS + 0.03"]) assert.ok(os.includes(line));
  for (const line of ['abs(c["frames"] - want) > 1', "1.5 / FPS + 0.03"]) assert.ok(source.includes(line));
});
