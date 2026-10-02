import assert from "node:assert/strict";
import test from "node:test";
import { cameraShots, monotoneCubic, posterLayout, youtubeChapters } from "../tools/render-youtube-scene.mjs";

test("the poster fits every scene cell inside 3840×2160 and important panels get bigger cells", () => {
  const poster = { title: "t", sections: [
    { label: "a", panels: [{ segmentIndex: 0, importance: 1 }, { segmentIndex: 1, importance: 3 }] },
    { label: "b", panels: [{ segmentIndex: 2, importance: 2 }, { segmentIndex: 3, importance: 2 }, { segmentIndex: 4, importance: 2 }] },
    { label: "c", panels: [{ segmentIndex: 5, importance: 2 }] },
  ] };
  const counts = new Map([[0, 2], [1, 3], [2, 4], [3, 2], [4, 3], [5, 5]]);
  const layout = posterLayout(poster, counts);
  const cells = layout.sections.flatMap((s) => s.panels.flatMap((p) => p.cells));
  assert.equal(cells.length, 19);
  for (const c of cells) assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 3840 && c.y + c.h <= 2160, JSON.stringify(c));
  const [small, big] = layout.sections[0].panels;
  assert.ok(big.cells[0].w > small.cells[0].w);
  assert.deepEqual(layout.sections.map((s) => s.panels.map((p) => p.number)), [["1a", "1b"], ["2a", "2b", "2c"], ["3a"]]);
});

test("camera curve passes through its keys without overshooting a hold", () => {
  const f = monotoneCubic([0, 1, 2, 3], [0, 0, 10, 10]);
  assert.equal(f(1), 0);
  assert.equal(f(2), 10);
  for (let x = 0; x <= 3; x += 0.05) assert.ok(f(x) >= -1e-9 && f(x) <= 10 + 1e-9, `overshoot at ${x}`);
});

test("YouTube chapters start at 0:00 and flag fewer than three sections", () => {
  const ok = youtubeChapters([{ label: "a", start: 1.4, end: 40 }, { label: "b", start: 40, end: 95 }, { label: "c", start: 95, end: 170 }]);
  assert.equal(ok.text.split("\n")[0], "0:00 01 a");
  assert.equal(ok.text.split("\n")[2], "1:35 03 c");
  assert.ok(ok.ok);
  assert.ok(!youtubeChapters([{ label: "a", start: 0, end: 50 }, { label: "b", start: 50, end: 90 }]).ok);
});

test("camera shots last at least 4 s plus the move, and caption-only scenes stay in the shot before them", () => {
  // Scenes start at these times (video seconds); scene 3 has nothing to draw.
  const starts = [2, 7, 8.5, 10, 16, 17, 30, 31.5], drawn = [true, true, true, false, true, true, true, true];
  const shots = cameraShots(starts, drawn, 33);
  assert.deepEqual(shots, [[0], [1, 2, 3], [4, 5, 6, 7]], "the 3 s last shot joins the one before");
  shots.slice(0, -1).forEach((shot, j) => assert.ok(starts[shots[j + 1][0]] - starts[shot[0]] >= 5));
  assert.deepEqual(cameraShots([2, 9, 20], [true, true, true], 22), [[0], [1, 2]], "a 2 s last shot joins the one before");
});
