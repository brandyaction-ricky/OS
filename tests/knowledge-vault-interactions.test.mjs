import test from "node:test";
import assert from "node:assert/strict";
import { matchesVaultName, newVaultFolder, canEditVaultDocument, selectedVaultDocuments, vaultFolderKey, readVaultStorage, writeVaultStorage, isStringArray, planVaultSelectionMove } from "../lib/knowledge-vault-interactions.ts";

test("folder names normalize, reject separators and preserve original roots", () => {
  assert.equal(newVaultFolder("02_Wiki", "  고객  ", []), "02_Wiki/고객");
  for (const name of ["", ".", "..", "a/b", "a\\b", "a\nb"]) assert.throws(() => newVaultFolder("", name, []));
  assert.throws(() => newVaultFolder("02_Wiki", "고객", ["02_Wiki/고객"]));
});
test("Korean folder and slash search supports initials", () => {
  assert.equal(matchesVaultName("02_Wiki/고객언어분석", "ㄱㄱ"), true);
  assert.equal(matchesVaultName("표 행과 열", "ㅍ"), true);
  assert.equal(matchesVaultName("Hello", "HEL"), true);
  assert.equal(matchesVaultName("표", "ㄱ"), false);
});
test("mixed folder-document selections deduplicate, match descendants exactly", () => {
  const rows = [{id:"a",folder:"02_Wiki"},{id:"b",folder:"02_Wiki/고객"},{id:"c",folder:"02_Wiki2"}];
  assert.deepEqual(selectedVaultDocuments(rows, new Set([vaultFolderKey("02_Wiki"),"b"])).map(row => row.id), ["a","b"]);
});
test("automatic editing never opens canon, review, archive or someone else's draft", () => {
  const own = {owner_id:"me",status:"draft"}, member = {id:"me",role:"member"}, admin = {id:"admin",role:"admin"};
  assert.equal(canEditVaultDocument(own, member), true);
  assert.equal(canEditVaultDocument({...own,status:"team"}, admin), true);
  assert.equal(canEditVaultDocument(own, {id:"other",role:"member"}), false);
  for (const status of ["canonical","review","reviewed","archived"]) assert.equal(canEditVaultDocument({...own,status}, admin), false);
});
test("mixed movement preserves nested paths and IDs, deduplicates folders and rejects collisions", () => {
  const rows = [{id:"a",title:"A",folder:"A",current_version:2},{id:"b",title:"B",folder:"A/child",current_version:4},{id:"c",title:"C",folder:"elsewhere",current_version:1}];
  const result = planVaultSelectionMove(rows,["A","A/child"],"target",["A","A/child","target"]);
  assert.deepEqual(result.plan.map(row => [row.id,row.to,row.version]),[["a","target/A",2],["b","target/A/child",4],["c","target",1]]);
  assert.throws(()=>planVaultSelectionMove(rows,["A"],"A/child",[]));
  assert.throws(()=>planVaultSelectionMove(rows,["A"],"target",["target/A"]));
  assert.throws(()=>planVaultSelectionMove([], ["x/A","y/A"],"target",[]));
  assert.deepEqual(planVaultSelectionMove([], ["A"],"target",[]).targets,[{from:"A",to:"target/A"}]);
  assert.equal(planVaultSelectionMove(rows.slice(0,2),["A"],"",[]).plan.length,0);
});
test("denied or malformed browser storage falls back without breaking the page", () => {
  const original = globalThis.window;
  try {
    globalThis.window = {localStorage:{getItem(){throw Error("denied");},setItem(){throw Error("full");},removeItem(){throw Error("denied");}}};
    assert.deepEqual(readVaultStorage("key",[],isStringArray), []);
    assert.equal(writeVaultStorage("key", []), false);
    assert.equal(writeVaultStorage("key", null), false);
    globalThis.window = {localStorage:{getItem(){return '{bad';}}};
    assert.deepEqual(readVaultStorage("key",[],isStringArray), []);
    globalThis.window = {localStorage:{getItem(){return '[1]';}}};
    assert.deepEqual(readVaultStorage("key",[],isStringArray), []);
  } finally { globalThis.window = original; }
});
