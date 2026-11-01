import assert from "node:assert/strict";
import test from "node:test";
import { NAV_STAGES } from "../lib/navigation.ts";
import { YOUTUBE_V1_CEO_STAGE, youtubeV1Stages } from "../lib/youtube-process/navigation.ts";
import { groupSidebarStages, restoreSidebarGroups, toggleSidebarGroup } from "../lib/sidebar-navigation.ts";

for (const [mode, stages] of [["legacy", NAV_STAGES], ["platform", [YOUTUBE_V1_CEO_STAGE, ...youtubeV1Stages(NAV_STAGES)]]]) {
  test(`${mode} sidebar grouping retains every existing menu, nested address and stage object`, () => {
    const grouped = groupSidebarStages(stages);
    const flattened = grouped.flatMap(group => group.stages);
    assert.equal(flattened.length, stages.length);
    for (const stage of stages) assert.equal(flattened.filter(item => item === stage).length, 1);
    const addresses = rows => rows.flatMap(s => s.pages.flatMap(p => [p.href, ...(p.children ?? []).map(c => c.href)])).sort();
    assert.deepEqual(addresses(flattened), addresses(stages));
    assert.equal(grouped.find(g => g.id === "knowledge").stages.find(s => s.id === "knowledge").href, "/knowledge/vault");
  });
}

test("grouping cannot reintroduce stages or permissions filtered out by the caller", () => {
  const input = NAV_STAGES.filter(stage => stage.id === "knowledge").map(stage => ({ ...stage, pages: stage.pages.slice(0, 1) }));
  const grouped = groupSidebarStages(input);
  assert.deepEqual(grouped.map(g => g.id), ["knowledge"]);
  assert.equal(grouped[0].stages[0], input[0]);
  assert.deepEqual(groupSidebarStages([]), []);
  const future = { id: "future-extension" };
  assert.equal(groupSidebarStages([future])[0].stages[0], future);
});

test("an old many-open preference migrates to the current location; explicit home close survives", () => {
  const ids = ["home", "content", "knowledge", "finance", "settings"];
  assert.deepEqual(restoreSidebarGroups(ids, "knowledge", { content: true, finance: true, settings: true }), { content: false, knowledge: true, finance: false, settings: false });
  assert.equal(restoreSidebarGroups(ids, "home", null).content, true);
  assert.equal(restoreSidebarGroups(ids, "home", "bad").content, true);
  assert.ok(Object.values(restoreSidebarGroups(ids, "home", { content: false })).every(value => !value));
  assert.equal(Object.values(restoreSidebarGroups(ids, "home", { content: true, finance: true })).filter(Boolean).length, 1);
  assert.deepEqual(restoreSidebarGroups([], "knowledge", {}), {});
});

test("opening another group closes the former, and the active group can be closed", () => {
  const opened = toggleSidebarGroup({ knowledge: true, finance: false }, "finance");
  assert.deepEqual(opened, { knowledge: false, finance: true });
  assert.deepEqual(toggleSidebarGroup(opened, "finance"), { knowledge: false, finance: false });
});
