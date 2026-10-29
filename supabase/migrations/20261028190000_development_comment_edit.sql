begin;

-- 수정 요청 대화: 내 댓글 고치기 · 지우기 (staff request 2026-10-28). A comment stays a row that is never deleted. Only its author may
-- change its text (the earlier text is kept in metadata.history by this trigger) or mark it deleted (metadata.deletedAt, text kept);
-- every other column and key stays as written. Inserts are checked exactly as before (20260921210000).
create or replace function public.os_development_comment_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  reply_id uuid;
  mention_ids jsonb := coalesce(new.metadata->'mentionIds', '[]'::jsonb);
  mention_names jsonb := coalesce(new.metadata->'mentionNames', '[]'::jsonb);
  edit_keys text[] := array['editedAt', 'deletedAt', 'history'];
  stamp text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if tg_op = 'DELETE' and old.record_type = 'development_comment' then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'UPDATE' and (old.record_type = 'development_comment' or new.record_type = 'development_comment') then
    if old.record_type <> new.record_type
      or auth.uid() is null or old.created_by is distinct from auth.uid()
      or coalesce(old.metadata->>'deletedAt', '') <> ''
      or (to_jsonb(new) - array['description', 'metadata', 'version', 'updated_by', 'updated_at'])
        is distinct from (to_jsonb(old) - array['description', 'metadata', 'version', 'updated_by', 'updated_at'])
      or jsonb_typeof(new.metadata) <> 'object'
      or (new.metadata - edit_keys) is distinct from (old.metadata - edit_keys)
      or btrim(coalesce(new.description, '')) = '' or char_length(new.description) > 5000
      or jsonb_array_length(coalesce(old.metadata->'history', '[]'::jsonb)) >= 50 then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_IMMUTABLE';
    end if;
    if coalesce(new.metadata->>'deletedAt', '') <> '' then
      if new.description is distinct from old.description then
        raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_IMMUTABLE';
      end if;
      new.metadata := old.metadata || jsonb_build_object('deletedAt', stamp);
    elsif new.description is distinct from old.description then
      new.metadata := old.metadata || jsonb_build_object('editedAt', stamp,
        'history', coalesce(old.metadata->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('body', old.description,
          'at', coalesce(nullif(old.metadata->>'editedAt', ''), to_char(old.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))));
    else
      new.metadata := old.metadata;
    end if;
    return new;
  end if;
  if new.record_type <> 'development_comment' then return new; end if;

  if new.parent_id is null or not exists (
    select 1 from public.os_records request
    where request.id = new.parent_id
      and request.record_type = 'ai_job'
      and request.metadata->>'kind' = 'development_request'
      and request.archived_at is null
  ) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_REQUEST_INVALID';
  end if;
  if btrim(coalesce(new.description, '')) = '' or char_length(new.description) > 5000 then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_BODY_INVALID';
  end if;
  if jsonb_typeof(new.metadata) <> 'object'
    or coalesce(new.metadata->>'kind', '') <> 'development_comment'
    or coalesce(new.metadata->>'requestId', '') <> new.parent_id::text
    or coalesce(new.metadata->>'authorName', '') = ''
    or char_length(new.metadata->>'authorName') > 200
    or coalesce(new.metadata->>'authorType', '') not in ('member', 'agent')
    or jsonb_typeof(mention_ids) <> 'array'
    or jsonb_typeof(mention_names) <> 'array'
    or jsonb_array_length(mention_ids) > 12
    or jsonb_array_length(mention_names) <> jsonb_array_length(mention_ids)
    or exists (
      select 1 from jsonb_each(new.metadata) item
      where item.key not in ('kind', 'requestId', 'replyTo', 'authorName', 'authorType', 'mentionIds', 'mentionNames')
    )
    or exists (
      select 1 from jsonb_array_elements(mention_ids) item
      where jsonb_typeof(item) <> 'string' or trim(both '"' from item::text) !~ '^[0-9a-fA-F-]{36}$'
    )
    or exists (
      select 1 from jsonb_array_elements(mention_names) item
      where jsonb_typeof(item) <> 'string' or char_length(trim(both '"' from item::text)) > 200
    )
    or (select count(*) from jsonb_array_elements_text(mention_ids))
      <> (select count(distinct value) from jsonb_array_elements_text(mention_ids)) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_METADATA_INVALID';
  end if;

  if coalesce(new.metadata->>'replyTo', '') <> '' then
    begin
      reply_id := (new.metadata->>'replyTo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_REPLY_INVALID';
    end;
    if not exists (
      select 1 from public.os_records parent_comment
      where parent_comment.id = reply_id
        and parent_comment.record_type = 'development_comment'
        and parent_comment.parent_id = new.parent_id
        and parent_comment.metadata->>'kind' = 'development_comment'
        and coalesce(parent_comment.metadata->>'replyTo', '') = ''
        and coalesce(parent_comment.metadata->>'deletedAt', '') = ''
        and parent_comment.archived_at is null
    ) then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_REPLY_INVALID';
    end if;
  end if;
  return new;
end;
$$;

commit;
