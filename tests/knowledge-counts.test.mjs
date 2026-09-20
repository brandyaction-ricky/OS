import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("knowledge totals expose their population and archive rule at every surface", async () => {
  const [definitions, documents, index, graphRoute, workspace, graph, monitoring] = await Promise.all([
    read("lib/knowledge-counts.ts"), read("app/api/v1/documents/route.ts"), read("app/api/v1/documents/index/route.ts"),
    read("app/api/v1/knowledge/graph/route.ts"), read("components/knowledge-workspace.tsx"), read("components/knowledge-graph-workspace.tsx"), read("components/monitoring-workspace.tsx"),
  ]);
  assert.match(definitions, /전체 문서 · 보관 포함/);
  assert.match(definitions, /전체 문서 · 보관 제외 · 연결 유무 무관/);
  assert.match(documents, /countDefinition: knowledgeCountDefinition\(scope\)/);
  assert.match(index, /countDefinition: knowledgeCountDefinition\(scope\)/);
  assert.match(graphRoute, /countDefinition: KNOWLEDGE_GRAPH_COUNT_DEFINITION/);
  assert.match(workspace, /countDefinition\?\.label/);
  assert.match(graph, /graph\.countDefinition\?\.label/);
  assert.match(monitoring, /전체 문서 · 보관 포함/);
  assert.match(documents, /view"\) === "counts"/);
  assert.match(documents, /aiAuthored/);
  assert.match(monitoring, /활성 · 보관 제외/);
  assert.match(monitoring, /AI·MCP 작성/);
  assert.match(monitoring, /휴지통/);
});
