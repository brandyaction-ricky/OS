import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildKnowledgeGraph, extractWikiLinks } from "../lib/knowledge-links.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("knowledge workspace is a two-column tree with collaborative defaults", async () => {
  const [workspace, css, migration] = await Promise.all([
    read("components/knowledge-workspace.tsx"),
    read("app/globals.css"),
    read("supabase/migrations-legacy/202608300009_knowledge_collaboration.sql"),
  ]);
  assert.match(workspace, /내 문서 \+ 회사 정본/);
  assert.match(workspace, /useState\(true\)/);
  assert.doesNotMatch(workspace, /현재 문서에서 찾기/);
  assert.doesNotMatch(workspace, /className="document-pane"/);
  assert.match(css, /grid-template-columns:280px minmax\(0,1fr\)/);
  assert.match(migration, /os_documents_active_member_select/);
});

test("knowledge workspace exposes folder selection, rename and document move controls", async () => {
  const workspace = (await Promise.all(["components/knowledge-workspace.tsx", "components/knowledge-folder-manager.tsx", "components/knowledge-document-mover.tsx", "components/knowledge-folder-picker.tsx"].map(read))).join("\n");
  assert.match(workspace, /폴더 관리/);
  assert.match(workspace, /폴더 이름 변경/);
  assert.match(workspace, /문서 위치 이동/);
  assert.match(workspace, /저장 위치/);
  assert.match(workspace, /폴더를 선택하세요/);
  assert.match(workspace, /이 폴더에 새 문서 만들기/);
});

test("wiki links produce automatic edges, backlinks and broken-link evidence", () => {
  assert.deepEqual(extractWikiLinks("[[정본]] [[정본|별칭]] [[없는 문서#절]]"), ["정본", "없는 문서"]);
  const graph = buildKnowledgeGraph([
    { id: "a", title: "초안", content_md: "[[정본]]과 [[없는 문서]]", folder: "개인", status: "draft", owner_id: "one" },
    { id: "b", title: "정본", content_md: "", folder: "회사", status: "canonical", owner_id: "two" },
  ]);
  assert.deepEqual(graph.edges, [{ source: "a", target: "b" }]);
  assert.equal(graph.nodes.find((node) => node.id === "b")?.incoming, 1);
  assert.deepEqual(graph.broken, [{ sourceId: "a", sourceTitle: "초안", targetTitle: "없는 문서", reason: "missing", candidates: [] }]);
});
