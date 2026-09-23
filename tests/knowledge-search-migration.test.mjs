import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260921213500_use_trigram_index_for_knowledge_search.sql",
  import.meta.url,
);

test("knowledge search migration uses the trigram indexable word-similarity operator", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /to_regclass\('public\.os_document_chunks_text_trgm'\)/);
  assert.match(sql, /set_config\('pg_trgm\.word_similarity_threshold', '0\.3', true\)/);
  assert.match(sql, /where p_query <% c\.chunk_text/);
  assert.doesNotMatch(sql, /where word_similarity\(p_query, c\.chunk_text\) > 0\.3/);
});

test("knowledge search migration preserves vector, RLS-filtered document and ranking contracts", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /order by c\.embedding <=> p_embedding/);
  assert.match(sql, /d\.status = any\(p_statuses\)/);
  assert.match(sql, /d\.folder like p_folder \|\| '%'/);
  assert.match(sql, /d\.brand = p_brand/);
  assert.match(sql, /coalesce\(1\.0 \/ \(60 \+ vec_rank\), 0\) \+ 1\.0 \/ \(60 \+ kw_rank\)/);
  assert.match(sql, /limit greatest\(1, least\(p_limit, 50\)\)/);
});
