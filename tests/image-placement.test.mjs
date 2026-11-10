import test from "node:test";
import assert from "node:assert/strict";
import { PLACEMENT_IDS, resolvePlacement } from "../lib/image-creative/placement.ts";

test("all image placements round protected edges inward and scale at both export resolutions", () => {
  for (const width of [1080, 1440]) for (const id of PLACEMENT_IDS) {
    const p = resolvePlacement("portrait", id, width);
    const { x, y, width: w, height: h } = p.safe;
    const full = id === "story" || id === "reel";
    assert.equal(p.width, width);
    assert.equal(p.height, width * (full ? 16/9 : id === "feed-square" ? 1 : 5/4));
    assert.ok(x >= width * (full ? .06 : .05) && width - x - w >= width * (full ? .06 : .05));
    assert.ok(y >= p.height * (full ? .14 : .05));
    assert.ok(p.height - y - h >= p.height * (full ? .4 : .05));
    assert.ok(w > 0 && h > 0);
  }
  assert.deepEqual(resolvePlacement("story").safe, {x: 65, y: 269, width: 950, height: 883});
  assert.throws(() => resolvePlacement("portrait","side-banner"));
  assert.throws(() => resolvePlacement("portrait","story",900));
});
