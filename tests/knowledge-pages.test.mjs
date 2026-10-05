import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { knowledgePageDescendants, canReparentKnowledgePage } from "../lib/knowledge-pages.ts";
import { knowledgeToggleMarkdown, parseKnowledgeToggle } from "../lib/knowledge-toggle.ts";
import { markdownBlocks, markdownSections } from "../lib/markdown-sections.ts";
import { canReadKnowledgeDocument } from "../lib/server/document-access.ts";

const page = (id, parent_document_id = null) => ({ id, parent_document_id });

test("page descendants follow stable IDs, and a page cannot move below itself", () => {
  const pages = [page("a"), page("b", "a"), page("c", "b"), page("d")];
  assert.deepEqual(knowledgePageDescendants(pages, "a").map(item => item.id), ["b", "c"]);
  assert.equal(canReparentKnowledgePage(pages, "a", "c"), false);
  assert.equal(canReparentKnowledgePage(pages, "b", "b"), false);
  assert.equal(canReparentKnowledgePage(pages, "b", "d"), true);
  assert.equal(canReparentKnowledgePage(pages, "b", null), true);
});

test("toggle markdown keeps folded headings and fenced delimiters in one block", () => {
  const body = "첫 문단\n\n## 접힌 제목\n```md\n:::\n```\n마지막 문단";
  const toggle = knowledgeToggleMarkdown("질문 \"인용\"", body);
  const source = `# 바깥 제목\n\n${toggle}\n\n## 다음 제목`;
  assert.deepEqual(parseKnowledgeToggle(toggle), { title: "질문 \"인용\"", body });
  assert.deepEqual(markdownBlocks(source), ["# 바깥 제목", toggle, "## 다음 제목"]);
  assert.deepEqual(markdownSections(source).children.map(item => item.title), ["바깥 제목"]);
  assert.deepEqual(markdownSections(source).children[0].children.map(item => item.title), ["다음 제목"]);
  assert.equal(parseKnowledgeToggle(":::toggle{title=\"x\"}\n본문"), null);
});

test("page migration is additive, guarded, and approval history is recorded", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261003122206_knowledge_page_tree.sql", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../supabase/migration-baseline.json", import.meta.url), "utf8"));
  const entry = manifest.forwardMigrations.find(item => item.file === "20261003122206_knowledge_page_tree.sql");
  assert.match(migration, /add column if not exists parent_document_id uuid/);
  assert.match(migration, /OS_PAGE_CYCLE/);
  assert.match(migration, /OS_PAGE_PARENT_VISIBILITY/);
  assert.match(migration, /OS_PAGE_HAS_ACTIVE_CHILDREN/);
  assert.match(migration, /OS_PAGE_CHILD_MOVE_DENIED/);
  assert.match(migration, /owner_id is distinct from auth\.uid\(\)/);
  assert.doesNotMatch(migration, /\b(?:truncate|delete from|drop table)\b/i);
  assert.equal(entry?.requiresApproval, true);
  assert.equal(entry?.developmentApprovedAt, "2026-10-04");
  assert.equal(entry?.productionApprovedAt, "2026-10-05");
  assert.deepEqual(entry?.appliedEnvironments, ["development", "production"]);
});

test("page moves accept the offset timestamp returned by Supabase", async () => {
  const route = await readFile(new URL("../app/api/v1/documents/pages/route.ts", import.meta.url), "utf8");
  assert.match(route, /expectedUpdatedAt: z\.string\(\)\.datetime\(\{ offset: true \}\)/);
});

test("page-aware routes keep ancestor access checks", async () => {
  const routes = [
    "../app/api/v1/knowledge-documents/route.ts",
    "../app/api/v1/documents/[id]/versions/route.ts",
    "../app/api/v1/knowledge-attachments/route.ts",
    "../app/api/v1/knowledge-assets/route.ts",
    "../lib/server/search.ts",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /readableKnowledgePages/, `${route} must check ancestor visibility`);
  }
});

test("a private parent hides its otherwise shared child from members and agents", async () => {
  const source = await readFile(new URL("../lib/server/knowledge-page-access.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const vmModule = { exports: {} };
  const parent = { id: "parent", parent_document_id: null, owner_id: "other", status: "draft" };
  const child = { id: "child", parent_document_id: "parent", owner_id: "reader", status: "team" };
  const service = { from() { return { select() { return this; }, in: async () => ({ data: [parent], error: null }) }; } };
  runInNewContext(compiled, {
    module: vmModule, exports: vmModule.exports,
    require: (name) => name === "./document-access"
      ? { canReadKnowledgeDocument }
      : { createServiceSupabase: () => service },
  });
  const { readableKnowledgePages } = vmModule.exports;
  const member = { type: "user", ownerId: "reader", role: "member", allowedStatuses: ["team"] };
  const agent = { ...member, type: "agent" };
  assert.equal((await readableKnowledgePages(member, [child])).has("child"), false);
  assert.equal((await readableKnowledgePages(agent, [child])).has("child"), false);
  assert.equal((await readableKnowledgePages({ ...member, role: "admin" }, [child])).has("child"), true);
});
