-- 지식 검색이 매번 4초를 넘던 문제 (개발 요청 37b3318d, 대표 결정 2026-10-31 「측정 · 준비」).
-- Measured on Production read-only (owner role, query 「연봉 이직 강점」):
--   * through the row rules the search did not finish within the editor's 58 s limit; the app gives up at 4 s and falls back.
--   * without row rules it took 6.7 s, 3.3 s of it the keyword part: at word_similarity 0.3 the trigram index hands back 9,255
--     chunks and 5,373 of them pass — almost all noise for Korean words. At 0.5: 1,320 checked, 3 pass, 0.6 s.
-- Two changes, nothing else:
--   1. os_document_chunks: a chunk is readable when its document is (the same rule, written as one lookup). Both policies called a
--      function for every chunk — os_can_read_document() and the recursive os_workspace_page_read() — so a search paid them
--      thousands of times. Now the caller's readable documents (os_documents' own policies, inlined on 2026-10-29) are found once
--      and each chunk is a hash lookup. Who can read what does not change.
--   2. os_search_knowledge: the keyword threshold 0.3 → 0.5. The embedding (HNSW) part still finds what is close in meaning.
-- No data, grant or table change. Undo: supabase/rollback/20261031090000_knowledge_search_speed.down.sql (not run by the migration runner).
begin;

alter policy os_document_chunks_select on public.os_document_chunks
  using (document_id in (select id from public.os_documents));
alter policy workspace_chunks_read on public.os_document_chunks
  using (document_id in (select id from public.os_documents));

create or replace function public.os_search_knowledge(
  p_query text,
  p_embedding extensions.vector default null::extensions.vector,
  p_limit integer default 10,
  p_statuses public.os_doc_status[] default array[
    'canonical'::public.os_doc_status,
    'reviewed'::public.os_doc_status,
    'review'::public.os_doc_status,
    'team'::public.os_doc_status
  ],
  p_folder text default null::text,
  p_brand text default null::text,
  p_min_score double precision default 0
)
returns table(
  chunk_id bigint,
  document_id uuid,
  title text,
  folder text,
  status public.os_doc_status,
  brand text,
  owner_id uuid,
  updated_at timestamptz,
  heading_path text,
  chunk_text text,
  score double precision,
  vec_sim double precision,
  kw_sim double precision
)
language sql
volatile
set search_path to public, extensions
as $$
  with
  -- The baseline deliberately avoids a function-level pg_trgm setting because
  -- it is not portable across every migration role. A transaction-local setting
  -- keeps the threshold (0.5 since 2026-10-31) while allowing the <% operator to use GIN.
  trgm_config as materialized (
    select set_config('pg_trgm.word_similarity_threshold', '0.5', true) as ignored
  ),
  vec_cand as (
    select c.id as chunk_id, 1 - (c.embedding <=> p_embedding) as vec_sim
    from os_document_chunks c
    where p_embedding is not null and c.embedding is not null
    order by c.embedding <=> p_embedding
    limit 100
  ),
  kw_cand as (
    select c.id as chunk_id, word_similarity(p_query, c.chunk_text) as kw_sim
    from trgm_config
    cross join os_document_chunks c
    where p_query <% c.chunk_text
    order by word_similarity(p_query, c.chunk_text) desc
    limit 100
  ),
  cand as (
    select chunk_id from vec_cand
    union
    select chunk_id from kw_cand
  ),
  base as (
    select c.id as chunk_id, c.document_id, d.title, d.folder, d.status, d.brand, d.owner_id, d.updated_at,
           c.heading_path, c.chunk_text,
           v.vec_sim,
           coalesce(k.kw_sim, word_similarity(p_query, c.chunk_text)) as kw_sim
    from cand
    join os_document_chunks c on c.id = cand.chunk_id
    join os_documents d on d.id = c.document_id
    left join vec_cand v on v.chunk_id = c.id
    left join kw_cand k on k.chunk_id = c.id
    where (p_statuses is null or d.status = any(p_statuses))
      and (p_folder is null or d.folder like p_folder || '%')
      and (p_brand is null or d.brand = p_brand)
  ),
  ranked as (
    select *,
      case when vec_sim is null then null else row_number() over (order by vec_sim desc nulls last) end as vec_rank,
      row_number() over (order by kw_sim desc) as kw_rank
    from base
  ),
  scored as (
    select *,
      coalesce(1.0 / (60 + vec_rank), 0) + 1.0 / (60 + kw_rank) as score
    from ranked
    where (vec_sim is not null and vec_sim > 0.2) or kw_sim > 0.05
  )
  select chunk_id, document_id, title, folder, status, brand, owner_id, updated_at, heading_path, chunk_text,
         score::float, vec_sim::float, kw_sim::float
  from scored
  where score >= p_min_score
  order by score desc
  limit greatest(1, least(p_limit, 50))
$$;

commit;
