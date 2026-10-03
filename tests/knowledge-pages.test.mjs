import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { knowledgePageDescendants, canReparentKnowledgePage } from "../lib/knowledge-pages.ts";
import { knowledgeToggleMarkdown, parseKnowledgeToggle } from "../lib/knowledge-toggle.ts";
import { markdownBlocks, markdownSections } from "../lib/markdown-sections.ts";

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

test("page migration is additive, guarded, and pending environment approval", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261003122206_knowledge_page_tree.sql", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../supabase/migration-baseline.json", import.meta.url), "utf8"));
  const entry = manifest.forwardMigrations.find(item => item.file === "20261003122206_knowledge_page_tree.sql");
  assert.match(migration, /add column if not exists parent_document_id uuid/);
  assert.match(migration, /OS_PAGE_CYCLE/);
  assert.match(migration, /OS_PAGE_PARENT_VISIBILITY/);
  assert.match(migration, /OS_PAGE_HAS_ACTIVE_CHILDREN/);
  assert.doesNotMatch(migration, /\b(?:truncate|delete from|drop table)\b/i);
  assert.equal(entry?.requiresApproval, true);
  assert.deepEqual(entry?.appliedEnvironments, []);
});
