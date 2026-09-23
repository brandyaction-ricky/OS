begin;

do $$
begin
  if to_regclass('public.os_document_chunks_text_trgm') is null then
    raise exception 'OS_SEARCH_TRIGRAM_INDEX_REQUIRED';
  end if;
  if to_regclass('public.os_document_chunks_embedding_hnsw') is null then
    raise exception 'OS_SEARCH_VECTOR_INDEX_REQUIRED';
  end if;
end;
$$;

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
  -- keeps the historical 0.3 threshold while allowing the <% operator to use GIN.
  trgm_config as materialized (
    select set_config('pg_trgm.word_similarity_threshold', '0.3', true) as ignored
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

comment on function public.os_search_knowledge(
  text,
  extensions.vector,
  integer,
  public.os_doc_status[],
  text,
  text,
  double precision
) is '브랜디 OS 검색 API. 벡터 HNSW와 인덱스 가능한 pg_trgm word-similarity 후보를 결합한다. RLS 적용(호출자 권한).';

commit;
