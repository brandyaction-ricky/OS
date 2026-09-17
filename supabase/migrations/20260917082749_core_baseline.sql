-- Schema-only Production snapshot. Contains no business rows, Auth users, or Storage objects.
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."os_doc_status" AS ENUM (
    'draft',
    'team',
    'review',
    'reviewed',
    'canonical',
    'archived'
);


ALTER TYPE "public"."os_doc_status" OWNER TO "postgres";


CREATE TYPE "public"."os_job_status" AS ENUM (
    'pending',
    'running',
    'done',
    'failed'
);


ALTER TYPE "public"."os_job_status" OWNER TO "postgres";


CREATE TYPE "public"."os_role" AS ENUM (
    'admin',
    'lead',
    'member'
);


ALTER TYPE "public"."os_role" OWNER TO "postgres";


CREATE TYPE "public"."os_skill_scope" AS ENUM (
    'personal',
    'team',
    'company'
);


ALTER TYPE "public"."os_skill_scope" OWNER TO "postgres";


CREATE TYPE "public"."os_skill_status" AS ENUM (
    'personal',
    'wiki_linked',
    'team_verified',
    'approved',
    'company',
    'pinned',
    'archived'
);


ALTER TYPE "public"."os_skill_status" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."os_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "folder" "text" DEFAULT '/'::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "content_md" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."os_doc_status" DEFAULT 'draft'::"public"."os_doc_status" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "team" "text" DEFAULT ''::"text" NOT NULL,
    "brand" "text",
    "source" "text" DEFAULT 'os'::"text" NOT NULL,
    "source_ref" "text",
    "current_version" integer DEFAULT 0 NOT NULL,
    "content_hash" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_documents_title_check" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 300)))
);


ALTER TABLE "public"."os_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."os_documents" IS '브랜디 OS 지식 창고 문서. 상태 변경은 os_set_document_status() 로만';



CREATE OR REPLACE FUNCTION "public"."os_agent_archive_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  k public.os_agent_keys;
  d public.os_documents;
  v_from public.os_doc_status;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.delete');
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.owner_id <> k.owner_user_id and d.status <> 'canonical' then
    raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001';
  end if;
  if d.status = 'archived' then return d; end if;

  v_from := d.status;
  perform set_config('os.status_change_ok', '1', true);
  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  update public.os_documents set status = 'archived' where id = p_document_id returning * into d;
  perform set_config('os.status_change_ok', '', true);

  insert into public.os_document_events (document_id, from_status, to_status, actor_id, note)
  values (
    p_document_id, v_from, 'archived', k.owner_user_id,
    concat('MCP 에이전트 ', k.name, ': ', coalesce(p_reason, '휴지통 이동'))
  );
  insert into public.os_agent_audit_logs (
    organization_id, agent_key_id, owner_user_id, action, document_id,
    title_snapshot, changed_fields, reason
  ) values (
    p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.delete', d.id,
    d.title, array['status'], coalesce(p_reason, '휴지통 이동')
  );
  return d;
end;
$$;


ALTER FUNCTION "public"."os_agent_archive_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_agent_create_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_title" "text", "p_content_md" "text", "p_folder" "text" DEFAULT 'AI 저장/검토 대기'::"text", "p_brand" "text" DEFAULT ''::"text", "p_team" "text" DEFAULT ''::"text", "p_tags" "text"[] DEFAULT '{}'::"text"[], "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  k public.os_agent_keys;
  d public.os_documents;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.create');
  if char_length(trim(p_title)) < 1 or char_length(p_content_md) < 1 then
    raise exception 'OS_AGENT_DOCUMENT_INVALID' using errcode = 'P0001';
  end if;

  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  insert into public.os_documents (
    title, content_md, folder, brand, team, tags, source, status, owner_id, created_by
  ) values (
    trim(p_title), p_content_md, coalesce(p_folder, 'AI 저장/검토 대기'),
    coalesce(p_brand, k.brand, ''), coalesce(nullif(p_team, ''), k.team, ''),
    coalesce(p_tags, '{}'), 'mcp', 'draft', k.owner_user_id, k.owner_user_id
  ) returning * into d;

  update public.os_document_versions
  set agent_key_id = p_agent_key_id
  where document_id = d.id and version_no = d.current_version;

  update public.os_document_events
  set actor_id = k.owner_user_id, note = concat('MCP 에이전트 ', k.name, ': 생성')
  where document_id = d.id and actor_id is null and note = 'created';

  insert into public.os_agent_audit_logs (
    organization_id, agent_key_id, owner_user_id, action, document_id,
    title_snapshot, changed_fields, reason
  ) values (
    p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.create', d.id,
    d.title, array['title', 'content_md', 'folder', 'tags'], coalesce(p_reason, '')
  );
  return d;
end;
$$;


ALTER FUNCTION "public"."os_agent_create_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_agent_update_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_changed_fields" "text"[], "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  k public.os_agent_keys;
  d public.os_documents;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.update');
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status = 'archived' then raise exception 'OS_AGENT_ARCHIVED_READ_ONLY' using errcode = 'P0001'; end if;
  if d.owner_id <> k.owner_user_id and d.status <> 'canonical' then
    raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001';
  end if;
  if d.current_version <> p_expected_version then
    raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001';
  end if;

  perform set_config('os.version_reason', coalesce(nullif(p_reason, ''), 'MCP 에이전트 수정'), true);
  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  update public.os_documents
  set title = p_title, content_md = p_content_md, folder = p_folder,
      brand = p_brand, team = p_team, tags = coalesce(p_tags, '{}')
  where id = p_document_id
  returning * into d;

  update public.os_document_versions
  set agent_key_id = p_agent_key_id
  where document_id = d.id and version_no = d.current_version;

  insert into public.os_agent_audit_logs (
    organization_id, agent_key_id, owner_user_id, action, document_id,
    title_snapshot, changed_fields, reason
  ) values (
    p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.update', d.id,
    d.title, coalesce(p_changed_fields, '{}'), coalesce(p_reason, '')
  );
  return d;
end;
$$;


ALTER FUNCTION "public"."os_agent_update_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_changed_fields" "text"[], "p_reason" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_agent_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "key_prefix" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['knowledge.read'::"text"] NOT NULL,
    "allowed_statuses" "public"."os_doc_status"[] DEFAULT ARRAY['canonical'::"public"."os_doc_status"] NOT NULL,
    "team" "text" DEFAULT ''::"text" NOT NULL,
    "brand" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "organization_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    CONSTRAINT "os_agent_keys_key_hash_check" CHECK (("key_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "os_agent_keys_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 80))),
    CONSTRAINT "os_agent_keys_scopes_check" CHECK (((("cardinality"("scopes") >= 1) AND ("cardinality"("scopes") <= 4)) AND ("scopes" <@ ARRAY['knowledge.read'::"text", 'knowledge.write'::"text", 'records.read'::"text", 'records.write'::"text"])))
);


ALTER TABLE "public"."os_agent_keys" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_assert_agent_write_access"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_action" "text") RETURNS "public"."os_agent_keys"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  k public.os_agent_keys;
  v_minute_limit integer := case when p_action = 'knowledge.delete' then 5 else 20 end;
  v_day_limit integer := case when p_action = 'knowledge.delete' then 30 else 200 end;
  v_minute_count integer;
  v_day_count integer;
begin
  select * into k
  from public.os_agent_keys
  where id = p_agent_key_id
    and organization_id = p_organization_id
    and active
    and 'knowledge.write' = any(scopes)
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'OS_AGENT_WRITE_DENIED' using errcode = 'P0001';
  end if;

  select count(*) into v_minute_count
  from public.os_agent_audit_logs
  where agent_key_id = p_agent_key_id
    and action = p_action
    and created_at >= now() - interval '1 minute';

  select count(*) into v_day_count
  from public.os_agent_audit_logs
  where agent_key_id = p_agent_key_id
    and action = p_action
    and created_at >= now() - interval '24 hours';

  if v_minute_count >= v_minute_limit or v_day_count >= v_day_limit then
    raise exception 'OS_AGENT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  return k;
end;
$$;


ALTER FUNCTION "public"."os_assert_agent_write_access"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_can_read_document"("p_owner" "uuid", "p_status" "public"."os_doc_status", "p_team" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when auth.uid() is null then false
    when os_is_admin() then true
    when p_owner = auth.uid() then true
    when p_status = 'draft' then false
    when p_status = 'team' then (p_team = '' or p_team = os_my_team() or os_is_lead_or_admin())
    else true end
$$;


ALTER FUNCTION "public"."os_can_read_document"("p_owner" "uuid", "p_status" "public"."os_doc_status", "p_team" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_can_read_skill"("p_owner" "uuid", "p_scope" "public"."os_skill_scope", "p_team" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when auth.uid() is null then false
    when os_is_admin() or p_owner = auth.uid() then true
    when p_scope = 'personal' then false
    when p_scope = 'team' then (p_team = '' or p_team = os_my_team() or os_is_lead_or_admin())
    else true end
$$;


ALTER FUNCTION "public"."os_can_read_skill"("p_owner" "uuid", "p_scope" "public"."os_skill_scope", "p_team" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_claim_embedding_job"() RETURNS TABLE("job_id" bigint, "doc_id" "uuid", "doc_hash" "text", "doc_title" "text", "doc_content" "text", "doc_folder" "text", "doc_brand" "text", "doc_status" "public"."os_doc_status")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare j os_embedding_jobs;
begin
  select * into j from os_embedding_jobs e
   where e.status in ('pending','failed') and e.attempts < 5
   order by e.created_at
   for update skip locked limit 1;
  if not found then return; end if;
  update os_embedding_jobs e set status='running', attempts=e.attempts+1, started_at=now() where e.id=j.id;
  return query
    select j.id, d.id, d.content_hash, d.title, d.content_md, d.folder, d.brand, d.status
      from os_documents d where d.id = j.document_id;
end $$;


ALTER FUNCTION "public"."os_claim_embedding_job"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'backlog'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "stage" "text" DEFAULT ''::"text" NOT NULL,
    "brand" "text" DEFAULT ''::"text" NOT NULL,
    "team" "text" DEFAULT ''::"text" NOT NULL,
    "owner_id" "uuid",
    "assignee_id" "uuid",
    "parent_id" "uuid",
    "due_date" "date",
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "progress" integer DEFAULT 0 NOT NULL,
    "metric_target" numeric,
    "metric_current" numeric,
    "metric_unit" "text" DEFAULT ''::"text" NOT NULL,
    "amount" numeric,
    "currency" "text" DEFAULT 'KRW'::"text" NOT NULL,
    "source_url" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_by" "uuid" NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    CONSTRAINT "os_records_brand_check" CHECK (("char_length"("brand") <= 120)),
    CONSTRAINT "os_records_check" CHECK ((("parent_id" IS NULL) OR ("parent_id" <> "id"))),
    CONSTRAINT "os_records_check1" CHECK ((("ends_at" IS NULL) OR ("starts_at" IS NULL) OR ("ends_at" >= "starts_at"))),
    CONSTRAINT "os_records_currency_check" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "os_records_description_check" CHECK (("char_length"("description") <= 20000)),
    CONSTRAINT "os_records_metric_unit_check" CHECK (("char_length"("metric_unit") <= 30)),
    CONSTRAINT "os_records_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "os_records_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100))),
    CONSTRAINT "os_records_record_type_check" CHECK (("record_type" = ANY (ARRAY['project'::"text", 'task'::"text", 'goal'::"text", 'kpi'::"text", 'decision'::"text", 'meeting'::"text", 'ai_job'::"text", 'development_log'::"text", 'deployment'::"text", 'content_topic'::"text", 'content_script'::"text", 'content_package'::"text", 'content_short'::"text", 'content_publish'::"text", 'content_metric'::"text", 'skill'::"text", 'knowledge_link'::"text", 'revenue'::"text", 'funnel'::"text", 'crm_action'::"text", 'customer'::"text", 'brand'::"text", 'connection'::"text", 'access_rule'::"text", 'company_setting'::"text", 'channel'::"text", 'leave_balance'::"text", 'leave_request'::"text", 'expense'::"text", 'contract'::"text", 'subscription'::"text", 'company_document'::"text"]))),
    CONSTRAINT "os_records_source_url_check" CHECK ((("source_url" IS NULL) OR ("char_length"("source_url") <= 2000))),
    CONSTRAINT "os_records_stage_check" CHECK (("char_length"("stage") <= 80)),
    CONSTRAINT "os_records_status_check" CHECK ((("char_length"("status") >= 1) AND ("char_length"("status") <= 40))),
    CONSTRAINT "os_records_tags_check" CHECK (("cardinality"("tags") <= 30)),
    CONSTRAINT "os_records_team_check" CHECK (("char_length"("team") <= 120)),
    CONSTRAINT "os_records_title_check" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 240))),
    CONSTRAINT "os_records_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."os_records" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_decide_leave_request"("p_request_id" "uuid", "p_expected_version" integer, "p_status" "text") RETURNS "public"."os_records"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  request_row public.os_records;
  balance_row public.os_records;
  leave_days numeric;
begin
  if not public.os_is_admin() then raise exception using errcode = '42501', message = 'ADMIN_REQUIRED'; end if;
  if p_status not in ('approved','rejected') then raise exception using errcode = '22023', message = 'INVALID_LEAVE_STATUS'; end if;
  select * into request_row from public.os_records
    where id = p_request_id and record_type = 'leave_request' and version = p_expected_version and archived_at is null
    for update;
  if request_row.id is null then return null; end if;
  if request_row.status <> 'pending' then raise exception using errcode = '22023', message = 'LEAVE_ALREADY_DECIDED'; end if;
  update public.os_records set status = p_status, updated_by = auth.uid()
    where id = request_row.id returning * into request_row;
  if p_status = 'approved' then
    leave_days := coalesce((request_row.metadata->>'days')::numeric, request_row.metric_current, 0);
    select * into balance_row from public.os_records
      where record_type = 'leave_balance' and archived_at is null
        and metadata->>'memberId' = coalesce(request_row.metadata->>'memberId', request_row.assignee_id::text)
      order by updated_at desc limit 1 for update;
    if balance_row.id is not null then
      update public.os_records set
        metric_current = greatest(0, coalesce(balance_row.metric_current, 0) - leave_days),
        progress = case when coalesce(balance_row.metric_target, 0) > 0 then
          round(((coalesce(balance_row.metric_target, 0) - greatest(0, coalesce(balance_row.metric_current, 0) - leave_days)) / balance_row.metric_target) * 100)::integer
          else 0 end,
        updated_by = auth.uid()
      where id = balance_row.id;
    end if;
  end if;
  return request_row;
end;
$$;


ALTER FUNCTION "public"."os_decide_leave_request"("p_request_id" "uuid", "p_expected_version" integer, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_development_request_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  new_request boolean := coalesce(new.metadata->>'kind', '') = 'development_request';
  old_request boolean := false;
  management_keys text[] := array['resolution', 'branch', 'commitSha', 'prUrl', 'deploymentUrl'];
  editable_metadata text[] := array['pageUrl', 'category', 'expectedResult', 'attachmentUrl', 'attachmentPath', 'attachmentName', 'attachmentSize', 'attachmentType'];
  metadata_key text;
  metadata_value text;
  only_reopen boolean;
begin
  if tg_op = 'UPDATE' then old_request := coalesce(old.metadata->>'kind', '') = 'development_request'; end if;
  if not old_request and not new_request then return new; end if;
  if not new_request or new.record_type <> 'ai_job' or (tg_op = 'UPDATE' and not old_request) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_KIND_IMMUTABLE';
  end if;
  if new.status not in ('backlog', 'active', 'review', 'done', 'blocked') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_STATUS_INVALID';
  end if;
  if jsonb_typeof(new.metadata) <> 'object' or exists (
    select 1 from jsonb_each(new.metadata) item
    where item.key <> all(array['kind','pageUrl','category','steps','expectedResult','attachmentUrl','attachmentPath','attachmentName','attachmentSize','attachmentType','resolution','branch','commitSha','prUrl','deploymentUrl'])
      or jsonb_typeof(item.value) <> 'string'
  ) then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_METADATA_INVALID'; end if;
  if coalesce(new.metadata->>'category', '') not in ('bug','usability','feature','question') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_CATEGORY_INVALID';
  end if;
  if char_length(coalesce(new.metadata->>'steps','')) > 8000
    or char_length(coalesce(new.metadata->>'expectedResult','')) > 8000
    or char_length(coalesce(new.metadata->>'attachmentName','')) > 240
    or char_length(coalesce(new.metadata->>'attachmentType','')) > 160
    or coalesce(new.metadata->>'attachmentSize','') !~ '^$|^[1-9][0-9]{0,8}$'
    or (coalesce(new.metadata->>'attachmentPath','') <> '' and new.metadata->>'attachmentPath' !~ '^requests/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm|pdf|txt|csv|doc|docx|ppt|pptx|xls|xlsx|zip)$')
    or char_length(coalesce(new.metadata->>'resolution','')) > 12000
    or char_length(coalesce(new.metadata->>'branch','')) > 300
    or (coalesce(new.metadata->>'commitSha','') <> '' and new.metadata->>'commitSha' !~ '^[a-fA-F0-9]{7,64}$') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_METADATA_TOO_LONG';
  end if;
  foreach metadata_key in array array['pageUrl','attachmentUrl','prUrl','deploymentUrl'] loop
    metadata_value := coalesce(new.metadata->>metadata_key, '');
    if char_length(metadata_value) > 2000 then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_URL_INVALID'; end if;
    if metadata_value <> '' then
      if metadata_key = 'pageUrl' and metadata_value ~ '^/($|[^/\\[:space:]])' and metadata_value !~ '[\\[:space:]]' then continue; end if;
      if metadata_value !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_URL_INVALID'; end if;
    end if;
  end loop;
  if new.status = 'done' and btrim(coalesce(new.metadata->>'resolution','')) = '' then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_RESOLUTION_REQUIRED'; end if;
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) and not exists (
    select 1 from public.os_records where id = new.parent_id and record_type = 'project' and archived_at is null
  ) then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_PROJECT_INVALID'; end if;
  if auth.uid() is null or public.os_is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'backlog' or new.created_by <> auth.uid() or new.owner_id is distinct from auth.uid() or new.assignee_id is not null or new.archived_at is not null or new.metadata ?| management_keys then
      raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_REPORTER_INSERT_FORBIDDEN';
    end if;
    return new;
  end if;
  if old.created_by <> auth.uid() then raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_OWNER_REQUIRED'; end if;
  only_reopen := old.status in ('done','review') and new.status = 'backlog'
    and (to_jsonb(new) - array['status','updated_by','updated_at','version']) = (to_jsonb(old) - array['status','updated_by','updated_at','version']);
  if only_reopen then return new; end if;
  if old.status <> 'backlog' or new.status <> 'backlog'
    or (to_jsonb(new) - array['title','description','priority','parent_id','metadata','updated_by','updated_at','version']) is distinct from (to_jsonb(old) - array['title','description','priority','parent_id','metadata','updated_by','updated_at','version'])
    or (new.metadata - editable_metadata) is distinct from (old.metadata - editable_metadata) then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_REPORTER_UPDATE_FORBIDDEN';
  end if;
  return new;
end;
$_$;


ALTER FUNCTION "public"."os_development_request_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_documents_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT'
     or (new.content_md is distinct from old.content_md)
     or (new.title is distinct from old.title) then
    insert into os_document_versions (document_id, version_no, title, content_md, author_id, reason)
    values (new.id, new.current_version, new.title, new.content_md, auth.uid(),
            coalesce(current_setting('os.version_reason', true), ''));
    if new.content_md <> '' then
      insert into os_embedding_jobs (document_id, content_hash)
      values (new.id, new.content_hash)
      on conflict do nothing;
    end if;
  end if;
  if tg_op = 'INSERT' then
    insert into os_document_events (document_id, from_status, to_status, actor_id, note)
    values (new.id, null, new.status, auth.uid(), 'created');
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."os_documents_after_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_documents_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.content_hash := md5(coalesce(new.content_md,''));
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid(), new.owner_id);
    new.current_version := 1;
  elsif (new.content_md is distinct from old.content_md) or (new.title is distinct from old.title) then
    new.current_version := old.current_version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."os_documents_before_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_documents_block_direct_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('os.status_change_ok', true), '') <> '1' then
    raise exception 'OS_STATUS_DIRECT_UPDATE_FORBIDDEN: use os_set_document_status()' using errcode='P0001';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."os_documents_block_direct_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_finish_embedding_job"("p_job_id" bigint, "p_chunks" "jsonb", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare j os_embedding_jobs; d os_documents;
begin
  select * into j from os_embedding_jobs where id = p_job_id;
  if not found then raise exception 'OS_JOB_NOT_FOUND' using errcode='P0002'; end if;
  if p_error is not null then
    update os_embedding_jobs set status='failed', last_error=p_error, finished_at=now() where id=p_job_id;
    return;
  end if;
  select * into d from os_documents where id = j.document_id;
  if d.content_hash <> j.content_hash then
    update os_embedding_jobs set status='done', last_error='stale', finished_at=now() where id=p_job_id;
    return;
  end if;
  delete from os_document_chunks where document_id = j.document_id;
  insert into os_document_chunks (document_id, chunk_index, chunk_text, heading_path, token_count, embedding, embedding_model, content_hash, meta)
  select j.document_id,
         (c->>'chunk_index')::int,
         c->>'chunk_text',
         coalesce(c->>'heading_path',''),
         coalesce((c->>'token_count')::int, 0),
         (c->>'embedding')::extensions.vector,
         coalesce(c->>'embedding_model','text-embedding-3-small'),
         j.content_hash,
         coalesce(c->'meta','{}'::jsonb)
  from jsonb_array_elements(p_chunks) c;
  update os_embedding_jobs set status='done', finished_at=now(), last_error=null where id=p_job_id;
end $$;


ALTER FUNCTION "public"."os_finish_embedding_job"("p_job_id" bigint, "p_chunks" "jsonb", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_get_document_versions"("p_document_id" "uuid") RETURNS TABLE("version_no" integer, "title" "text", "content_md" "text", "author_id" "uuid", "author_name" "text", "reason" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select v.version_no, v.title, v.content_md, v.author_id,
         coalesce(p.display_name, p.email, '초기 가져오기') as author_name,
         coalesce(v.reason, ''), v.created_at
  from public.os_document_versions v
  left join public.os_profiles p on p.id = v.author_id
  join public.os_documents d on d.id = v.document_id
  where v.document_id = p_document_id
    and exists (
      select 1 from public.os_profiles me
      where me.id = auth.uid() and me.is_active
        and public.os_can_read_document(d.owner_id, d.status, d.team)
    )
  order by v.version_no desc;
$$;


ALTER FUNCTION "public"."os_get_document_versions"("p_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_domain text := lower(split_part(coalesce(new.email,''), '@', 2));
  v_gate   boolean;
begin
  select exists(select 1 from os_allowed_domains) into v_gate;
  if v_gate and not exists (select 1 from os_allowed_domains where domain = v_domain) then
    raise exception 'OS_SIGNUP_DOMAIN_NOT_ALLOWED: %', v_domain using errcode = 'P0001';
  end if;

  insert into os_profiles (id, email, display_name, employee_id)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    (select id from erp_employees e where lower(e.email) = lower(new.email) and e.email <> '' limit 1)
  )
  on conflict (id) do nothing;
  return new;
end $$;


ALTER FUNCTION "public"."os_handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_has_finance_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.os_profiles p
    where p.id = auth.uid() and p.is_active and (p.finance_access or p.role = 'admin')
  );
$$;


ALTER FUNCTION "public"."os_has_finance_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_is_active_member"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.os_profiles p
    where p.id = auth.uid() and p.is_active = true
  );
$$;


ALTER FUNCTION "public"."os_is_active_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(os_my_role() = 'admin', false)
$$;


ALTER FUNCTION "public"."os_is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_is_lead_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(os_my_role() in ('admin','lead'), false)
$$;


ALTER FUNCTION "public"."os_is_lead_or_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_list_documents_v3"("p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0, "p_statuses" "public"."os_doc_status"[] DEFAULT NULL::"public"."os_doc_status"[], "p_owner" "uuid" DEFAULT NULL::"uuid", "p_folder_prefix" "text" DEFAULT NULL::"text", "p_query" "text" DEFAULT NULL::"text", "p_include_content" boolean DEFAULT false) RETURNS TABLE("id" "uuid", "title" "text", "content_md" "text", "folder" "text", "status" "public"."os_doc_status", "brand" "text", "team" "text", "tags" "text"[], "source" "text", "source_ref" "text", "owner_id" "uuid", "created_by" "uuid", "current_version" integer, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "total_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select d.id, d.title,
         case when p_include_content then d.content_md else '' end,
         d.folder, d.status, d.brand, d.team, d.tags, d.source, d.source_ref,
         d.owner_id, d.created_by, d.current_version, d.created_at, d.updated_at,
         count(*) over() as total_count
  from public.os_documents d
  where exists (
      select 1 from public.os_profiles me
      where me.id = auth.uid() and me.is_active
    )
    and (public.os_is_admin() or public.os_can_read_document(d.owner_id, d.status, d.team))
    and (p_statuses is null or d.status = any(p_statuses))
    and (p_owner is null or d.owner_id = p_owner)
    and (p_folder_prefix is null or d.folder = p_folder_prefix or d.folder like p_folder_prefix || '/%')
    and (p_query is null or d.title ilike '%' || p_query || '%' or d.content_md ilike '%' || p_query || '%')
  order by d.updated_at desc, d.id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;


ALTER FUNCTION "public"."os_list_documents_v3"("p_limit" integer, "p_offset" integer, "p_statuses" "public"."os_doc_status"[], "p_owner" "uuid", "p_folder_prefix" "text", "p_query" "text", "p_include_content" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_my_role"() RETURNS "public"."os_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from os_profiles where id = auth.uid() and is_active
$$;


ALTER FUNCTION "public"."os_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_my_team"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select team from os_profiles where id = auth.uid() and is_active
$$;


ALTER FUNCTION "public"."os_my_team"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_records_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.os_record_events (
      record_id, actor_id, event_type, to_status, snapshot
    ) values (
      new.id, new.created_by, 'created', new.status, to_jsonb(new)
    );
  else
    if old.title is distinct from new.title then v_changed := array_append(v_changed, 'title'); end if;
    if old.description is distinct from new.description then v_changed := array_append(v_changed, 'description'); end if;
    if old.status is distinct from new.status then v_changed := array_append(v_changed, 'status'); end if;
    if old.assignee_id is distinct from new.assignee_id then v_changed := array_append(v_changed, 'assignee_id'); end if;
    if old.due_date is distinct from new.due_date then v_changed := array_append(v_changed, 'due_date'); end if;
    if old.progress is distinct from new.progress then v_changed := array_append(v_changed, 'progress'); end if;
    if old.metric_current is distinct from new.metric_current then v_changed := array_append(v_changed, 'metric_current'); end if;
    if old.archived_at is distinct from new.archived_at then v_changed := array_append(v_changed, 'archived_at'); end if;
    insert into public.os_record_events (
      record_id, actor_id, event_type, from_status, to_status, changed_fields, snapshot
    ) values (
      new.id, new.updated_by,
      case when new.archived_at is not null and old.archived_at is null then 'archived' else 'updated' end,
      old.status, new.status, v_changed, to_jsonb(new)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."os_records_after_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_records_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
    new.owner_id := coalesce(new.owner_id, auth.uid());
    new.version := 1;
  else
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."os_records_before_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_restore_document_version"("p_document_id" "uuid", "p_version_no" integer, "p_expected_version" integer, "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  d public.os_documents;
  v public.os_document_versions;
  v_admin boolean := public.os_is_admin();
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.current_version <> p_expected_version then
    raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001';
  end if;
  if not (
    v_admin
    or (d.owner_id = auth.uid() and d.status <> 'canonical')
    or (
      d.status = 'canonical'
      and exists (select 1 from public.os_profiles p where p.id = auth.uid() and p.is_active)
    )
  ) then raise exception 'OS_RESTORE_DENIED' using errcode = 'P0001'; end if;

  select * into v from public.os_document_versions
  where document_id = p_document_id and version_no = p_version_no;
  if not found then raise exception 'OS_VERSION_NOT_FOUND' using errcode = 'P0002'; end if;

  perform set_config('os.version_reason', coalesce(nullif(p_reason, ''), format('v%s로 되돌리기', p_version_no)), true);
  update public.os_documents set title = v.title, content_md = v.content_md
  where id = p_document_id returning * into d;
  return d;
end;
$$;


ALTER FUNCTION "public"."os_restore_document_version"("p_document_id" "uuid", "p_version_no" integer, "p_expected_version" integer, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_rollback_document"("p_document_id" "uuid", "p_version_no" integer, "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v os_document_versions; d os_documents;
begin
  select * into v from os_document_versions where document_id = p_document_id and version_no = p_version_no;
  if not found then raise exception 'OS_VERSION_NOT_FOUND' using errcode='P0002'; end if;
  select * into d from os_documents where id = p_document_id;
  if not (os_is_admin() or (d.owner_id = auth.uid() and d.status <> 'canonical')) then
    raise exception 'OS_ROLLBACK_DENIED (status=%)', d.status using errcode='P0001';
  end if;
  perform set_config('os.version_reason', coalesce(nullif(p_reason,''), 'rollback to v'||p_version_no), true);
  update os_documents set title = v.title, content_md = v.content_md where id = p_document_id returning * into d;
  perform set_config('os.version_reason', '', true);
  return d;
end $$;


ALTER FUNCTION "public"."os_rollback_document"("p_document_id" "uuid", "p_version_no" integer, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_search_documents"("p_query" "text", "p_embedding" "extensions"."vector" DEFAULT NULL::"extensions"."vector", "p_limit" integer DEFAULT 10, "p_statuses" "public"."os_doc_status"[] DEFAULT ARRAY['canonical'::"public"."os_doc_status", 'reviewed'::"public"."os_doc_status", 'review'::"public"."os_doc_status", 'team'::"public"."os_doc_status"], "p_folder" "text" DEFAULT NULL::"text", "p_brand" "text" DEFAULT NULL::"text") RETURNS TABLE("document_id" "uuid", "title" "text", "folder" "text", "status" "public"."os_doc_status", "brand" "text", "updated_at" timestamp with time zone, "best_score" double precision, "best_chunk" "text", "hits" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select document_id, title, folder, status, brand, updated_at,
         max(score)::float, (array_agg(chunk_text order by score desc))[1], count(*)::int
  from os_search_knowledge(p_query, p_embedding, 50, p_statuses, p_folder, p_brand, 0)
  group by document_id, title, folder, status, brand, updated_at
  order by max(score) desc
  limit greatest(1, least(p_limit, 50))
$$;


ALTER FUNCTION "public"."os_search_documents"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_search_knowledge"("p_query" "text", "p_embedding" "extensions"."vector" DEFAULT NULL::"extensions"."vector", "p_limit" integer DEFAULT 10, "p_statuses" "public"."os_doc_status"[] DEFAULT ARRAY['canonical'::"public"."os_doc_status", 'reviewed'::"public"."os_doc_status", 'review'::"public"."os_doc_status", 'team'::"public"."os_doc_status"], "p_folder" "text" DEFAULT NULL::"text", "p_brand" "text" DEFAULT NULL::"text", "p_min_score" double precision DEFAULT 0) RETURNS TABLE("chunk_id" bigint, "document_id" "uuid", "title" "text", "folder" "text", "status" "public"."os_doc_status", "brand" "text", "owner_id" "uuid", "updated_at" timestamp with time zone, "heading_path" "text", "chunk_text" "text", "score" double precision, "vec_sim" double precision, "kw_sim" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  with
  vec_cand as (
    select c.id as chunk_id, 1 - (c.embedding <=> p_embedding) as vec_sim
    from os_document_chunks c
    where p_embedding is not null and c.embedding is not null
    order by c.embedding <=> p_embedding
    limit 100
  ),
  kw_cand as (
    select c.id as chunk_id, word_similarity(p_query, c.chunk_text) as kw_sim
    from os_document_chunks c
    where word_similarity(p_query, c.chunk_text) > 0.3
    order by word_similarity(p_query, c.chunk_text) desc
    limit 100
  ),
  cand as (
    select chunk_id from vec_cand union select chunk_id from kw_cand
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
    left join kw_cand  k on k.chunk_id = c.id
    where (p_statuses is null or d.status = any(p_statuses))
      and (p_folder is null or d.folder like p_folder || '%')
      and (p_brand  is null or d.brand = p_brand)
  ),
  ranked as (
    select *,
      case when vec_sim is null then null else row_number() over (order by vec_sim desc nulls last) end as vec_rank,
      row_number() over (order by kw_sim desc) as kw_rank
    from base
  ),
  scored as (
    select *,
      coalesce(1.0/(60 + vec_rank), 0) + 1.0/(60 + kw_rank) as score
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


ALTER FUNCTION "public"."os_search_knowledge"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text", "p_min_score" double precision) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."os_search_knowledge"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text", "p_min_score" double precision) IS '브랜디 OS 검색 API. 어떤 에이전트든 이 함수 하나로 회사 지식을 읽는다. RLS 적용(호출자 권한).';



CREATE OR REPLACE FUNCTION "public"."os_set_document_status"("p_document_id" "uuid", "p_to" "public"."os_doc_status", "p_note" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  d public.os_documents;
  v_from public.os_doc_status;
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_active boolean;
  v_admin boolean := public.os_is_admin();
  ok boolean := false;
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;

  select exists(
    select 1 from public.os_profiles p where p.id = v_uid and p.is_active
  ) into v_active;
  v_from := d.status;
  v_owner := d.owner_id = v_uid;
  if v_from = p_to then return d; end if;

  ok := case
    when v_from = 'draft' and p_to = 'team' then v_owner or v_admin
    when v_from in ('draft', 'team', 'review', 'reviewed') and p_to = 'canonical'
      then (v_owner and v_active) or v_admin
    when v_from = 'team' and p_to = 'review' then (v_owner and v_active) or v_admin
    when v_from = 'review' and p_to = 'reviewed' then v_active or v_admin
    when v_from = 'reviewed' and p_to = 'review' then v_active or v_admin
    when v_from = 'canonical' and p_to = 'review' then v_active or v_admin
    when p_to = 'archived' then v_admin or (v_owner and v_from <> 'canonical')
    when p_to = 'draft' and v_from in ('team', 'review', 'reviewed') then v_owner or v_admin
    when v_from = 'archived' and p_to in ('draft', 'team') then v_owner or v_admin
    else false
  end;
  if not ok then
    raise exception 'OS_STATUS_TRANSITION_DENIED: % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  perform set_config('os.status_change_ok', '1', true);
  update public.os_documents set status = p_to where id = p_document_id returning * into d;
  perform set_config('os.status_change_ok', '', true);
  insert into public.os_document_events (document_id, from_status, to_status, actor_id, note)
  values (p_document_id, v_from, p_to, v_uid, coalesce(p_note, ''));
  return d;
end;
$$;


ALTER FUNCTION "public"."os_set_document_status"("p_document_id" "uuid", "p_to" "public"."os_doc_status", "p_note" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "skill_md" "text" DEFAULT ''::"text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "scope" "public"."os_skill_scope" DEFAULT 'personal'::"public"."os_skill_scope" NOT NULL,
    "status" "public"."os_skill_status" DEFAULT 'personal'::"public"."os_skill_status" NOT NULL,
    "team" "text" DEFAULT ''::"text" NOT NULL,
    "current_version" integer DEFAULT 0 NOT NULL,
    "pinned_version" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_skills_name_check" CHECK (("name" ~ '^[a-z0-9][a-z0-9-]{1,63}$'::"text"))
);


ALTER TABLE "public"."os_skills" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_set_skill_status"("p_skill_id" "uuid", "p_to" "public"."os_skill_status", "p_note" "text" DEFAULT ''::"text") RETURNS "public"."os_skills"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s os_skills; v_from os_skill_status; v_owner boolean; v_lead boolean := os_is_lead_or_admin(); v_admin boolean := os_is_admin(); ok boolean := false; v_scope os_skill_scope;
begin
  select * into s from os_skills where id = p_skill_id for update;
  if not found then raise exception 'OS_SKILL_NOT_FOUND' using errcode='P0002'; end if;
  v_from := s.status; v_owner := (s.owner_id = auth.uid()); v_scope := s.scope;
  if v_from = p_to then return s; end if;
  ok := case
    when v_from='personal'      and p_to='wiki_linked'   then (v_owner or v_admin) and exists(select 1 from os_skill_evidence e where e.skill_id = p_skill_id)
    when v_from='wiki_linked'   and p_to='team_verified' then v_lead
    when v_from='team_verified' and p_to='approved'      then v_lead
    when v_from='approved'      and p_to='company'       then v_admin
    when v_from='company'       and p_to='pinned'        then v_admin
    when v_from='pinned'        and p_to='approved'      then v_admin
    when p_to='archived'                                 then v_owner or v_admin
    when p_to='personal'                                 then v_owner or v_admin
    else false end;
  if not ok then
    raise exception 'OS_SKILL_TRANSITION_DENIED: % -> %', v_from, p_to using errcode='P0001';
  end if;
  v_scope := case when p_to in ('team_verified','approved') then 'team'
                  when p_to in ('company','pinned') then 'company'
                  when p_to = 'personal' then 'personal'
                  else v_scope end;
  perform set_config('os.status_change_ok','1',true);
  update os_skills set status = p_to, scope = v_scope,
         pinned_version = case when p_to='pinned' then current_version else null end
   where id = p_skill_id returning * into s;
  perform set_config('os.status_change_ok','',true);
  insert into os_skill_events (skill_id, from_status, to_status, actor_id, note) values (p_skill_id, v_from, p_to, auth.uid(), coalesce(p_note,''));
  return s;
end $$;


ALTER FUNCTION "public"."os_set_skill_status"("p_skill_id" "uuid", "p_to" "public"."os_skill_status", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_skills_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' or (new.skill_md is distinct from old.skill_md) or (new.description is distinct from old.description) then
    insert into os_skill_versions (skill_id, version_no, description, skill_md, author_id, reason)
    values (new.id, new.current_version, new.description, new.skill_md, auth.uid(), coalesce(current_setting('os.version_reason', true), ''));
  end if;
  if tg_op = 'INSERT' then
    insert into os_skill_events (skill_id, from_status, to_status, actor_id, note) values (new.id, null, new.status, auth.uid(), 'created');
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."os_skills_after_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_skills_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.current_version := 1;
  elsif (new.skill_md is distinct from old.skill_md) or (new.description is distinct from old.description) then
    if old.status = 'pinned' and coalesce(current_setting('os.status_change_ok', true), '') <> '1' then
      raise exception 'OS_SKILL_PINNED: unpin(→approved) before editing' using errcode='P0001';
    end if;
    new.current_version := old.current_version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."os_skills_before_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_skills_block_direct_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if (new.status is distinct from old.status or new.scope is distinct from old.scope)
     and coalesce(current_setting('os.status_change_ok', true), '') <> '1' then
    raise exception 'OS_STATUS_DIRECT_UPDATE_FORBIDDEN: use os_set_skill_status()' using errcode='P0001';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."os_skills_block_direct_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin new.updated_at := now(); return new; end $$;


ALTER FUNCTION "public"."os_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."os_update_document"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare d public.os_documents;
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.current_version <> p_expected_version then
    raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001';
  end if;
  perform set_config('os.version_reason', coalesce(p_reason, ''), true);
  update public.os_documents
  set title = p_title, content_md = p_content_md, folder = p_folder,
      brand = p_brand, team = p_team, tags = coalesce(p_tags, '{}')
  where id = p_document_id
  returning * into d;
  return d;
end;
$$;


ALTER FUNCTION "public"."os_update_document"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_bank_accounts" (
    "id" bigint NOT NULL,
    "bank_name" "text" NOT NULL,
    "account_name" "text" DEFAULT ''::"text" NOT NULL,
    "account_alias" "text" NOT NULL,
    "account_number" "text" NOT NULL,
    "account_type" "text" DEFAULT 'checking'::"text" NOT NULL,
    "balance" numeric(14,0) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "opened_date" "date",
    "responsible_employee_id" bigint,
    "purpose" "text" DEFAULT ''::"text" NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_bank_accounts_account_type_check" CHECK (("account_type" = ANY (ARRAY['checking'::"text", 'savings'::"text", 'loan'::"text", 'other'::"text"]))),
    CONSTRAINT "erp_bank_accounts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."erp_bank_accounts" OWNER TO "postgres";


ALTER TABLE "public"."erp_bank_accounts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_bank_accounts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_card_usages" (
    "id" bigint NOT NULL,
    "company_card_id" bigint,
    "evidence_method" "text" DEFAULT 'corporate-card'::"text" NOT NULL,
    "transaction_date" "date" NOT NULL,
    "merchant" "text" NOT NULL,
    "amount" numeric(14,0) DEFAULT 0 NOT NULL,
    "requested_amount" numeric(14,0) DEFAULT 0 NOT NULL,
    "purpose" "text" NOT NULL,
    "user_employee_id" bigint,
    "evidence_status" "text" DEFAULT 'missing'::"text" NOT NULL,
    "due_date" "date",
    "receipt_url" "text" DEFAULT ''::"text" NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_card_usages_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "erp_card_usages_evidence_method_check" CHECK (("evidence_method" = ANY (ARRAY['corporate-card'::"text", 'tax-invoice'::"text", 'cash-receipt'::"text", 'other'::"text"]))),
    CONSTRAINT "erp_card_usages_evidence_status_check" CHECK (("evidence_status" = ANY (ARRAY['missing'::"text", 'submitted'::"text", 'confirmed'::"text"]))),
    CONSTRAINT "erp_card_usages_requested_amount_check" CHECK (("requested_amount" >= (0)::numeric))
);


ALTER TABLE "public"."erp_card_usages" OWNER TO "postgres";


ALTER TABLE "public"."erp_card_usages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_card_usages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_company_cards" (
    "id" bigint NOT NULL,
    "card_company" "text" NOT NULL,
    "card_name" "text" DEFAULT ''::"text" NOT NULL,
    "card_alias" "text" NOT NULL,
    "card_last4" "text" NOT NULL,
    "holder_name" "text" DEFAULT ''::"text" NOT NULL,
    "credit_limit" numeric(14,0) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "issued_date" "date",
    "expiry_month" "text",
    "responsible_employee_id" bigint,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_company_cards_card_last4_check" CHECK (("card_last4" ~ '^\d{4}$'::"text")),
    CONSTRAINT "erp_company_cards_credit_limit_check" CHECK (("credit_limit" >= (0)::numeric)),
    CONSTRAINT "erp_company_cards_expiry_month_check" CHECK ((("expiry_month" IS NULL) OR ("expiry_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'::"text"))),
    CONSTRAINT "erp_company_cards_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."erp_company_cards" OWNER TO "postgres";


ALTER TABLE "public"."erp_company_cards" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_company_cards_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_employees" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "department" "text" DEFAULT '경영지원'::"text" NOT NULL,
    "join_date" "date" NOT NULL,
    "annual_allowance" numeric(5,1),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "position" "text" DEFAULT '담당자'::"text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "birth_date" "date",
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "emergency_contact" "text" DEFAULT ''::"text" NOT NULL,
    "employment_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_employees_employment_status_check" CHECK (("employment_status" = ANY (ARRAY['active'::"text", 'leave'::"text", 'retired'::"text"])))
);


ALTER TABLE "public"."erp_employees" OWNER TO "postgres";


ALTER TABLE "public"."erp_employees" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_employees_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_employment_contracts" (
    "id" bigint NOT NULL,
    "employee_id" bigint NOT NULL,
    "contract_type" "text" DEFAULT 'permanent'::"text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "monthly_salary" numeric(14,0) DEFAULT 0 NOT NULL,
    "weekly_hours" numeric(5,1) DEFAULT 40 NOT NULL,
    "work_start_time" time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    "work_end_time" time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    "probation_end_date" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_employment_contracts_contract_type_check" CHECK (("contract_type" = ANY (ARRAY['permanent'::"text", 'fixed'::"text", 'part-time'::"text", 'freelance'::"text"]))),
    CONSTRAINT "erp_employment_contracts_monthly_salary_check" CHECK (("monthly_salary" >= (0)::numeric)),
    CONSTRAINT "erp_employment_contracts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'expired'::"text"]))),
    CONSTRAINT "erp_employment_contracts_weekly_hours_check" CHECK (("weekly_hours" >= (0)::numeric))
);


ALTER TABLE "public"."erp_employment_contracts" OWNER TO "postgres";


ALTER TABLE "public"."erp_employment_contracts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_employment_contracts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_expenses" (
    "id" bigint NOT NULL,
    "expense_date" "date" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text" NOT NULL,
    "vendor" "text" DEFAULT ''::"text" NOT NULL,
    "amount" numeric(14,0) NOT NULL,
    "payment_method" "text" DEFAULT '법인카드'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cost_type" "text" DEFAULT 'variable'::"text" NOT NULL,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "recurring_active" boolean DEFAULT false NOT NULL,
    "recurring_day" smallint,
    "recurring_parent_id" bigint,
    "recurring_month" "text",
    "source_card_usage_id" bigint,
    "employee_id" bigint,
    CONSTRAINT "erp_expenses_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "erp_expenses_cost_type_check" CHECK (("cost_type" = ANY (ARRAY['fixed'::"text", 'variable'::"text"]))),
    CONSTRAINT "erp_expenses_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['paid'::"text", 'scheduled'::"text"]))),
    CONSTRAINT "erp_expenses_recurring_day_check" CHECK ((("recurring_day" IS NULL) OR (("recurring_day" >= 1) AND ("recurring_day" <= 31))))
);


ALTER TABLE "public"."erp_expenses" OWNER TO "postgres";


ALTER TABLE "public"."erp_expenses" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_expenses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_hr_settings" (
    "id" bigint NOT NULL,
    "kind" "text" NOT NULL,
    "value" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_hr_settings_kind_check" CHECK (("kind" = ANY (ARRAY['department'::"text", 'position'::"text"]))),
    CONSTRAINT "erp_hr_settings_value_check" CHECK ((("char_length"("value") >= 1) AND ("char_length"("value") <= 50)))
);


ALTER TABLE "public"."erp_hr_settings" OWNER TO "postgres";


ALTER TABLE "public"."erp_hr_settings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_hr_settings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_leave_entries" (
    "id" bigint NOT NULL,
    "employee_id" bigint NOT NULL,
    "leave_date" "date" NOT NULL,
    "amount" numeric(3,1) NOT NULL,
    "leave_type" "text" DEFAULT 'full'::"text" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_leave_entries_amount_check" CHECK (("amount" = ANY (ARRAY[0.5, 1.0]))),
    CONSTRAINT "erp_leave_entries_leave_type_check" CHECK (("leave_type" = ANY (ARRAY['full'::"text", 'half-am'::"text", 'half-pm'::"text"])))
);


ALTER TABLE "public"."erp_leave_entries" OWNER TO "postgres";


ALTER TABLE "public"."erp_leave_entries" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_leave_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_payrolls" (
    "id" bigint NOT NULL,
    "payroll_month" "text" NOT NULL,
    "employee_id" bigint NOT NULL,
    "base_pay" numeric(14,0) DEFAULT 0 NOT NULL,
    "meal_allowance" numeric(14,0) DEFAULT 0 NOT NULL,
    "childcare_allowance" numeric(14,0) DEFAULT 0 NOT NULL,
    "fixed_overtime_pay" numeric(14,0) DEFAULT 0 NOT NULL,
    "holiday_pay" numeric(14,0) DEFAULT 0 NOT NULL,
    "research_allowance" numeric(14,0) DEFAULT 0 NOT NULL,
    "other_allowance" numeric(14,0) DEFAULT 0 NOT NULL,
    "total_pay" numeric(14,0) DEFAULT 0 NOT NULL,
    "pension_base" numeric(14,0) DEFAULT 0 NOT NULL,
    "health_base" numeric(14,0) DEFAULT 0 NOT NULL,
    "employment_base" numeric(14,0) DEFAULT 0 NOT NULL,
    "auto_insurance" boolean DEFAULT true NOT NULL,
    "national_pension" numeric(14,0) DEFAULT 0 NOT NULL,
    "health_insurance" numeric(14,0) DEFAULT 0 NOT NULL,
    "long_term_care" numeric(14,0) DEFAULT 0 NOT NULL,
    "employment_insurance" numeric(14,0) DEFAULT 0 NOT NULL,
    "income_tax" numeric(14,0) DEFAULT 0 NOT NULL,
    "local_income_tax" numeric(14,0) DEFAULT 0 NOT NULL,
    "other_deduction" numeric(14,0) DEFAULT 0 NOT NULL,
    "total_deduction" numeric(14,0) DEFAULT 0 NOT NULL,
    "net_pay" numeric(14,0) DEFAULT 0 NOT NULL,
    "payment_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "payment_date" "date",
    "rate_year" integer DEFAULT 2026 NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_payrolls_base_pay_check" CHECK (("base_pay" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_childcare_allowance_check" CHECK (("childcare_allowance" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_employment_base_check" CHECK (("employment_base" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_employment_insurance_check" CHECK (("employment_insurance" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_fixed_overtime_pay_check" CHECK (("fixed_overtime_pay" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_health_base_check" CHECK (("health_base" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_health_insurance_check" CHECK (("health_insurance" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_holiday_pay_check" CHECK (("holiday_pay" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_income_tax_check" CHECK (("income_tax" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_local_income_tax_check" CHECK (("local_income_tax" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_long_term_care_check" CHECK (("long_term_care" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_meal_allowance_check" CHECK (("meal_allowance" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_national_pension_check" CHECK (("national_pension" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_net_pay_check" CHECK (("net_pay" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_other_allowance_check" CHECK (("other_allowance" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['draft'::"text", 'confirmed'::"text", 'paid'::"text"]))),
    CONSTRAINT "erp_payrolls_payroll_month_check" CHECK (("payroll_month" ~ '^\d{4}-\d{2}$'::"text")),
    CONSTRAINT "erp_payrolls_pension_base_check" CHECK (("pension_base" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_research_allowance_check" CHECK (("research_allowance" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_total_deduction_check" CHECK (("total_deduction" >= (0)::numeric)),
    CONSTRAINT "erp_payrolls_total_pay_check" CHECK (("total_pay" >= (0)::numeric))
);


ALTER TABLE "public"."erp_payrolls" OWNER TO "postgres";


ALTER TABLE "public"."erp_payrolls" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_payrolls_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."erp_revenues" (
    "id" bigint NOT NULL,
    "revenue_date" "date" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text" NOT NULL,
    "client" "text" DEFAULT ''::"text" NOT NULL,
    "amount" numeric(14,0) NOT NULL,
    "payment_method" "text" DEFAULT '계좌이체'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'received'::"text" NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "erp_revenues_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "erp_revenues_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['received'::"text", 'expected'::"text"])))
);


ALTER TABLE "public"."erp_revenues" OWNER TO "postgres";


ALTER TABLE "public"."erp_revenues" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."erp_revenues_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_ad_performance_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "brand_key" "text" NOT NULL,
    "metric_date" "date" NOT NULL,
    "spend" numeric(18,2) DEFAULT 0 NOT NULL,
    "attributed_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "conversions" numeric(18,4) DEFAULT 0 NOT NULL,
    "impressions" bigint DEFAULT 0 NOT NULL,
    "clicks" bigint DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'KRW'::"text" NOT NULL,
    "source_account" "text" DEFAULT ''::"text" NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_ad_performance_daily_attributed_revenue_check" CHECK (("attributed_revenue" >= (0)::numeric)),
    CONSTRAINT "os_ad_performance_daily_brand_key_check" CHECK (("brand_key" = ANY (ARRAY['myin'::"text", 'brandyedu'::"text"]))),
    CONSTRAINT "os_ad_performance_daily_clicks_check" CHECK (("clicks" >= 0)),
    CONSTRAINT "os_ad_performance_daily_conversions_check" CHECK (("conversions" >= (0)::numeric)),
    CONSTRAINT "os_ad_performance_daily_currency_check" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "os_ad_performance_daily_impressions_check" CHECK (("impressions" >= 0)),
    CONSTRAINT "os_ad_performance_daily_provider_check" CHECK (("provider" = ANY (ARRAY['meta'::"text", 'google'::"text"]))),
    CONSTRAINT "os_ad_performance_daily_spend_check" CHECK (("spend" >= (0)::numeric))
);


ALTER TABLE "public"."os_ad_performance_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_ad_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "brand_key" "text" NOT NULL,
    "status" "text" NOT NULL,
    "range_start" "date" NOT NULL,
    "range_end" "date" NOT NULL,
    "rows_written" integer DEFAULT 0 NOT NULL,
    "error_message" "text" DEFAULT ''::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "os_ad_sync_runs_brand_key_check" CHECK (("brand_key" = ANY (ARRAY['myin'::"text", 'brandyedu'::"text"]))),
    CONSTRAINT "os_ad_sync_runs_provider_check" CHECK (("provider" = ANY (ARRAY['meta'::"text", 'google'::"text"]))),
    CONSTRAINT "os_ad_sync_runs_rows_written_check" CHECK (("rows_written" >= 0)),
    CONSTRAINT "os_ad_sync_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'done'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."os_ad_sync_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_agent_audit_logs" (
    "id" bigint NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "agent_key_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "document_id" "uuid",
    "title_snapshot" "text" DEFAULT ''::"text" NOT NULL,
    "changed_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "record_id" "uuid",
    CONSTRAINT "os_agent_audit_logs_action_check" CHECK (("action" = ANY (ARRAY['knowledge.create'::"text", 'knowledge.update'::"text", 'knowledge.delete'::"text", 'record.create'::"text", 'record.update'::"text", 'record.delete'::"text", 'record.restore'::"text"])))
);


ALTER TABLE "public"."os_agent_audit_logs" OWNER TO "postgres";


ALTER TABLE "public"."os_agent_audit_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."os_agent_audit_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_allowed_domains" (
    "domain" "text" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."os_allowed_domains" OWNER TO "postgres";


COMMENT ON TABLE "public"."os_allowed_domains" IS 'SSO 가입 허용 도메인. 비어 있으면 제한 없음';



CREATE TABLE IF NOT EXISTS "public"."os_channel_turns" (
    "id" bigint NOT NULL,
    "channel" "text" NOT NULL,
    "external_user_id" "text" NOT NULL,
    "external_chat_id" "text",
    "question" "text" NOT NULL,
    "answer" "text" NOT NULL,
    "source_document_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "saved_document_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_channel_turns_answer_check" CHECK ((("char_length"("answer") >= 1) AND ("char_length"("answer") <= 12000))),
    CONSTRAINT "os_channel_turns_channel_check" CHECK (("channel" = ANY (ARRAY['telegram'::"text", 'os_chat'::"text", 'mcp'::"text"]))),
    CONSTRAINT "os_channel_turns_question_check" CHECK ((("char_length"("question") >= 1) AND ("char_length"("question") <= 4000)))
);


ALTER TABLE "public"."os_channel_turns" OWNER TO "postgres";


ALTER TABLE "public"."os_channel_turns" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."os_channel_turns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_document_chunks" (
    "id" bigint NOT NULL,
    "document_id" "uuid" NOT NULL,
    "chunk_index" integer NOT NULL,
    "chunk_text" "text" NOT NULL,
    "heading_path" "text" DEFAULT ''::"text" NOT NULL,
    "token_count" integer DEFAULT 0 NOT NULL,
    "embedding" "extensions"."vector"(1536),
    "embedding_model" "text" DEFAULT 'text-embedding-3-small'::"text" NOT NULL,
    "content_hash" "text" DEFAULT ''::"text" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."os_document_chunks" OWNER TO "postgres";


COMMENT ON TABLE "public"."os_document_chunks" IS 'pgvector 청크. Python 워커가 os_claim/finish_embedding_job 으로 채움';



ALTER TABLE "public"."os_document_chunks" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."os_document_chunks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_document_events" (
    "id" bigint NOT NULL,
    "document_id" "uuid" NOT NULL,
    "from_status" "public"."os_doc_status",
    "to_status" "public"."os_doc_status" NOT NULL,
    "actor_id" "uuid",
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."os_document_events" OWNER TO "postgres";


ALTER TABLE "public"."os_document_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."os_document_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_document_links" (
    "from_id" "uuid" NOT NULL,
    "to_id" "uuid" NOT NULL,
    "link_text" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."os_document_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_document_versions" (
    "id" bigint NOT NULL,
    "document_id" "uuid" NOT NULL,
    "version_no" integer NOT NULL,
    "title" "text" NOT NULL,
    "content_md" "text" NOT NULL,
    "author_id" "uuid",
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "agent_key_id" "uuid"
);


ALTER TABLE "public"."os_document_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."os_document_versions" IS '저장마다 1행. 롤백은 os_rollback_document()';



ALTER TABLE "public"."os_document_versions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."os_document_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_embedding_jobs" (
    "id" bigint NOT NULL,
    "document_id" "uuid" NOT NULL,
    "content_hash" "text" NOT NULL,
    "status" "public"."os_job_status" DEFAULT 'pending'::"public"."os_job_status" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone
);


ALTER TABLE "public"."os_embedding_jobs" OWNER TO "postgres";


ALTER TABLE "public"."os_embedding_jobs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."os_embedding_jobs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_organizations_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "os_organizations_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{1,62}$'::"text"))
);


ALTER TABLE "public"."os_organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "role" "public"."os_role" DEFAULT 'member'::"public"."os_role" NOT NULL,
    "team" "text" DEFAULT ''::"text" NOT NULL,
    "employee_id" bigint,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "affiliation" "text" DEFAULT '브랜디액션'::"text" NOT NULL,
    "roles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "onboarding" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "finance_access" boolean DEFAULT false NOT NULL,
    "legal_name" "text" DEFAULT ''::"text" NOT NULL,
    "must_change_password" boolean DEFAULT false NOT NULL,
    "password_changed_at" timestamp with time zone,
    "password_reset_at" timestamp with time zone,
    "password_reset_by" "uuid"
);


ALTER TABLE "public"."os_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."os_profiles" IS '브랜디 OS 사용자. auth.users 1:1. role=admin|lead|member';



CREATE TABLE IF NOT EXISTS "public"."os_record_events" (
    "id" bigint NOT NULL,
    "record_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "event_type" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "changed_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_record_events_event_type_check" CHECK ((("char_length"("event_type") >= 1) AND ("char_length"("event_type") <= 80))),
    CONSTRAINT "os_record_events_note_check" CHECK (("char_length"("note") <= 4000))
);


ALTER TABLE "public"."os_record_events" OWNER TO "postgres";


ALTER TABLE "public"."os_record_events" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."os_record_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_search_logs" (
    "id" bigint NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "text" NOT NULL,
    "query_length" integer NOT NULL,
    "mode" "text" NOT NULL,
    "result_count" integer DEFAULT 0 NOT NULL,
    "took_ms" integer DEFAULT 0 NOT NULL,
    "degraded" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_search_logs_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['user'::"text", 'agent'::"text"]))),
    CONSTRAINT "os_search_logs_mode_check" CHECK (("mode" = ANY (ARRAY['hybrid'::"text", 'keyword'::"text", 'semantic'::"text"]))),
    CONSTRAINT "os_search_logs_query_length_check" CHECK ((("query_length" >= 0) AND ("query_length" <= 1000))),
    CONSTRAINT "os_search_logs_result_count_check" CHECK (("result_count" >= 0)),
    CONSTRAINT "os_search_logs_took_ms_check" CHECK (("took_ms" >= 0))
);


ALTER TABLE "public"."os_search_logs" OWNER TO "postgres";


ALTER TABLE "public"."os_search_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."os_search_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_security_audit_logs" (
    "id" bigint NOT NULL,
    "actor_id" "uuid",
    "target_user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "os_security_audit_logs_action_check" CHECK (("action" = ANY (ARRAY['account.created'::"text", 'password.changed'::"text", 'password.reset'::"text"])))
);


ALTER TABLE "public"."os_security_audit_logs" OWNER TO "postgres";


ALTER TABLE "public"."os_security_audit_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."os_security_audit_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_skill_events" (
    "id" bigint NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "from_status" "public"."os_skill_status",
    "to_status" "public"."os_skill_status" NOT NULL,
    "actor_id" "uuid",
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."os_skill_events" OWNER TO "postgres";


ALTER TABLE "public"."os_skill_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."os_skill_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_skill_evidence" (
    "skill_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."os_skill_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_skill_versions" (
    "id" bigint NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "version_no" integer NOT NULL,
    "description" "text" NOT NULL,
    "skill_md" "text" NOT NULL,
    "author_id" "uuid",
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."os_skill_versions" OWNER TO "postgres";


ALTER TABLE "public"."os_skill_versions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."os_skill_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."os_telegram_users" (
    "external_user_id" "text" NOT NULL,
    "external_chat_id" "text",
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "username" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "decided_by" "uuid",
    CONSTRAINT "os_telegram_users_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."os_telegram_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_youtube_connections" (
    "owner_id" "uuid" NOT NULL,
    "encrypted_refresh_token" "text" NOT NULL,
    "encrypted_access_token" "text",
    "access_token_expires_at" timestamp with time zone,
    "scope" "text" DEFAULT ''::"text" NOT NULL,
    "channel_id" "text" DEFAULT ''::"text" NOT NULL,
    "channel_title" "text" DEFAULT ''::"text" NOT NULL,
    "connected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."os_youtube_connections" OWNER TO "postgres";


ALTER TABLE ONLY "public"."erp_bank_accounts"
    ADD CONSTRAINT "erp_bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_card_usages"
    ADD CONSTRAINT "erp_card_usages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_company_cards"
    ADD CONSTRAINT "erp_company_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_employees"
    ADD CONSTRAINT "erp_employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_employment_contracts"
    ADD CONSTRAINT "erp_employment_contracts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_expenses"
    ADD CONSTRAINT "erp_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_hr_settings"
    ADD CONSTRAINT "erp_hr_settings_kind_value_key" UNIQUE ("kind", "value");



ALTER TABLE ONLY "public"."erp_hr_settings"
    ADD CONSTRAINT "erp_hr_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_leave_entries"
    ADD CONSTRAINT "erp_leave_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_payrolls"
    ADD CONSTRAINT "erp_payrolls_payroll_month_employee_id_key" UNIQUE ("payroll_month", "employee_id");



ALTER TABLE ONLY "public"."erp_payrolls"
    ADD CONSTRAINT "erp_payrolls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_revenues"
    ADD CONSTRAINT "erp_revenues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_ad_performance_daily"
    ADD CONSTRAINT "os_ad_performance_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_ad_performance_daily"
    ADD CONSTRAINT "os_ad_performance_daily_provider_brand_key_metric_date_key" UNIQUE ("provider", "brand_key", "metric_date");



ALTER TABLE ONLY "public"."os_ad_sync_runs"
    ADD CONSTRAINT "os_ad_sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_agent_audit_logs"
    ADD CONSTRAINT "os_agent_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_agent_keys"
    ADD CONSTRAINT "os_agent_keys_key_hash_key" UNIQUE ("key_hash");



ALTER TABLE ONLY "public"."os_agent_keys"
    ADD CONSTRAINT "os_agent_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_allowed_domains"
    ADD CONSTRAINT "os_allowed_domains_pkey" PRIMARY KEY ("domain");



ALTER TABLE ONLY "public"."os_channel_turns"
    ADD CONSTRAINT "os_channel_turns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_document_chunks"
    ADD CONSTRAINT "os_document_chunks_document_id_chunk_index_key" UNIQUE ("document_id", "chunk_index");



ALTER TABLE ONLY "public"."os_document_chunks"
    ADD CONSTRAINT "os_document_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_document_events"
    ADD CONSTRAINT "os_document_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_document_links"
    ADD CONSTRAINT "os_document_links_pkey" PRIMARY KEY ("from_id", "to_id");



ALTER TABLE ONLY "public"."os_document_versions"
    ADD CONSTRAINT "os_document_versions_document_id_version_no_key" UNIQUE ("document_id", "version_no");



ALTER TABLE ONLY "public"."os_document_versions"
    ADD CONSTRAINT "os_document_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_documents"
    ADD CONSTRAINT "os_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_embedding_jobs"
    ADD CONSTRAINT "os_embedding_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_organizations"
    ADD CONSTRAINT "os_organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_organizations"
    ADD CONSTRAINT "os_organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."os_profiles"
    ADD CONSTRAINT "os_profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."os_profiles"
    ADD CONSTRAINT "os_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_record_events"
    ADD CONSTRAINT "os_record_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_records"
    ADD CONSTRAINT "os_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_search_logs"
    ADD CONSTRAINT "os_search_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_security_audit_logs"
    ADD CONSTRAINT "os_security_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_skill_events"
    ADD CONSTRAINT "os_skill_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_skill_evidence"
    ADD CONSTRAINT "os_skill_evidence_pkey" PRIMARY KEY ("skill_id", "document_id");



ALTER TABLE ONLY "public"."os_skill_versions"
    ADD CONSTRAINT "os_skill_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_skill_versions"
    ADD CONSTRAINT "os_skill_versions_skill_id_version_no_key" UNIQUE ("skill_id", "version_no");



ALTER TABLE ONLY "public"."os_skills"
    ADD CONSTRAINT "os_skills_owner_id_name_key" UNIQUE ("owner_id", "name");



ALTER TABLE ONLY "public"."os_skills"
    ADD CONSTRAINT "os_skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_telegram_users"
    ADD CONSTRAINT "os_telegram_users_pkey" PRIMARY KEY ("external_user_id");



ALTER TABLE ONLY "public"."os_youtube_connections"
    ADD CONSTRAINT "os_youtube_connections_pkey" PRIMARY KEY ("owner_id");



CREATE INDEX "erp_bank_accounts_responsible_idx" ON "public"."erp_bank_accounts" USING "btree" ("responsible_employee_id");



CREATE INDEX "erp_bank_accounts_status_idx" ON "public"."erp_bank_accounts" USING "btree" ("status");



CREATE INDEX "erp_card_usages_card_idx" ON "public"."erp_card_usages" USING "btree" ("company_card_id");



CREATE INDEX "erp_card_usages_date_idx" ON "public"."erp_card_usages" USING "btree" ("transaction_date" DESC);



CREATE INDEX "erp_card_usages_status_idx" ON "public"."erp_card_usages" USING "btree" ("evidence_status");



CREATE INDEX "erp_company_cards_responsible_idx" ON "public"."erp_company_cards" USING "btree" ("responsible_employee_id");



CREATE INDEX "erp_company_cards_status_idx" ON "public"."erp_company_cards" USING "btree" ("status");



CREATE INDEX "erp_contracts_employee_idx" ON "public"."erp_employment_contracts" USING "btree" ("employee_id");



CREATE INDEX "erp_contracts_end_date_idx" ON "public"."erp_employment_contracts" USING "btree" ("end_date");



CREATE INDEX "erp_expenses_category_idx" ON "public"."erp_expenses" USING "btree" ("category");



CREATE INDEX "erp_expenses_cost_type_idx" ON "public"."erp_expenses" USING "btree" ("cost_type");



CREATE INDEX "erp_expenses_date_idx" ON "public"."erp_expenses" USING "btree" ("expense_date" DESC);



CREATE INDEX "erp_expenses_employee_id_idx" ON "public"."erp_expenses" USING "btree" ("employee_id");



CREATE INDEX "erp_expenses_recurring_active_idx" ON "public"."erp_expenses" USING "btree" ("is_recurring", "recurring_active") WHERE ("is_recurring" = true);



CREATE UNIQUE INDEX "erp_expenses_recurring_month_unique" ON "public"."erp_expenses" USING "btree" ("recurring_parent_id", "recurring_month");



CREATE UNIQUE INDEX "erp_expenses_source_card_usage_id_uidx" ON "public"."erp_expenses" USING "btree" ("source_card_usage_id");



CREATE INDEX "erp_leave_entries_date_idx" ON "public"."erp_leave_entries" USING "btree" ("leave_date" DESC);



CREATE INDEX "erp_leave_entries_employee_idx" ON "public"."erp_leave_entries" USING "btree" ("employee_id");



CREATE INDEX "erp_payrolls_employee_idx" ON "public"."erp_payrolls" USING "btree" ("employee_id");



CREATE INDEX "erp_payrolls_month_idx" ON "public"."erp_payrolls" USING "btree" ("payroll_month" DESC);



CREATE INDEX "erp_revenues_category_idx" ON "public"."erp_revenues" USING "btree" ("category");



CREATE INDEX "erp_revenues_date_idx" ON "public"."erp_revenues" USING "btree" ("revenue_date" DESC);



CREATE INDEX "os_ad_performance_daily_date_idx" ON "public"."os_ad_performance_daily" USING "btree" ("metric_date" DESC, "brand_key", "provider");



CREATE INDEX "os_ad_sync_runs_latest_idx" ON "public"."os_ad_sync_runs" USING "btree" ("provider", "brand_key", "started_at" DESC);



CREATE INDEX "os_agent_audit_logs_agent_created_idx" ON "public"."os_agent_audit_logs" USING "btree" ("agent_key_id", "created_at" DESC);



CREATE INDEX "os_agent_audit_logs_document_created_idx" ON "public"."os_agent_audit_logs" USING "btree" ("document_id", "created_at" DESC);



CREATE INDEX "os_agent_audit_logs_record_created_idx" ON "public"."os_agent_audit_logs" USING "btree" ("record_id", "created_at" DESC);



CREATE INDEX "os_agent_keys_active_idx" ON "public"."os_agent_keys" USING "btree" ("active", "expires_at") WHERE "active";



CREATE INDEX "os_channel_turns_user_idx" ON "public"."os_channel_turns" USING "btree" ("channel", "external_user_id", "created_at" DESC);



CREATE INDEX "os_document_chunks_doc_idx" ON "public"."os_document_chunks" USING "btree" ("document_id");



CREATE INDEX "os_document_chunks_embedding_hnsw" ON "public"."os_document_chunks" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "os_document_chunks_text_trgm" ON "public"."os_document_chunks" USING "gin" ("chunk_text" "extensions"."gin_trgm_ops");



CREATE INDEX "os_document_events_doc_idx" ON "public"."os_document_events" USING "btree" ("document_id", "created_at" DESC);



CREATE INDEX "os_document_links_to_idx" ON "public"."os_document_links" USING "btree" ("to_id");



CREATE INDEX "os_documents_folder_idx" ON "public"."os_documents" USING "btree" ("folder");



CREATE INDEX "os_documents_owner_idx" ON "public"."os_documents" USING "btree" ("owner_id");



CREATE UNIQUE INDEX "os_documents_source_ref_unique" ON "public"."os_documents" USING "btree" ("source", "source_ref") WHERE ("source_ref" IS NOT NULL);



CREATE INDEX "os_documents_status_idx" ON "public"."os_documents" USING "btree" ("status");



CREATE INDEX "os_documents_tags_gin" ON "public"."os_documents" USING "gin" ("tags");



CREATE INDEX "os_documents_title_trgm" ON "public"."os_documents" USING "gin" ("title" "extensions"."gin_trgm_ops");



CREATE UNIQUE INDEX "os_embedding_jobs_dedupe" ON "public"."os_embedding_jobs" USING "btree" ("document_id", "content_hash") WHERE ("status" = ANY (ARRAY['pending'::"public"."os_job_status", 'running'::"public"."os_job_status"]));



CREATE INDEX "os_embedding_jobs_pending_idx" ON "public"."os_embedding_jobs" USING "btree" ("status", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"public"."os_job_status", 'failed'::"public"."os_job_status"]));



CREATE INDEX "os_profiles_team_idx" ON "public"."os_profiles" USING "btree" ("team");



CREATE INDEX "os_record_events_actor_idx" ON "public"."os_record_events" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "os_record_events_record_idx" ON "public"."os_record_events" USING "btree" ("record_id", "created_at" DESC);



CREATE INDEX "os_records_assignee_idx" ON "public"."os_records" USING "btree" ("assignee_id", "due_date") WHERE ("archived_at" IS NULL);



CREATE INDEX "os_records_brand_team_idx" ON "public"."os_records" USING "btree" ("brand", "team", "updated_at" DESC) WHERE ("archived_at" IS NULL);



CREATE INDEX "os_records_development_request_inbox_idx" ON "public"."os_records" USING "btree" ("status", "created_at" DESC, "id" DESC) WHERE (("archived_at" IS NULL) AND ("record_type" = 'ai_job'::"text") AND (("metadata" ->> 'kind'::"text") = 'development_request'::"text"));



CREATE INDEX "os_records_parent_idx" ON "public"."os_records" USING "btree" ("parent_id", "record_type") WHERE ("archived_at" IS NULL);



CREATE INDEX "os_records_project_history_idx" ON "public"."os_records" USING "btree" ("parent_id", "record_type", "updated_at" DESC) WHERE (("archived_at" IS NULL) AND ("record_type" = ANY (ARRAY['task'::"text", 'ai_job'::"text", 'decision'::"text", 'development_log'::"text", 'deployment'::"text"])));



CREATE INDEX "os_records_tags_idx" ON "public"."os_records" USING "gin" ("tags");



CREATE INDEX "os_records_type_status_idx" ON "public"."os_records" USING "btree" ("record_type", "status", "updated_at" DESC) WHERE ("archived_at" IS NULL);



CREATE INDEX "os_search_logs_actor_idx" ON "public"."os_search_logs" USING "btree" ("actor_type", "actor_id", "created_at" DESC);



CREATE INDEX "os_search_logs_created_idx" ON "public"."os_search_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "os_security_audit_actor_created_idx" ON "public"."os_security_audit_logs" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "os_security_audit_target_created_idx" ON "public"."os_security_audit_logs" USING "btree" ("target_user_id", "created_at" DESC);



CREATE INDEX "os_skills_name_trgm" ON "public"."os_skills" USING "gin" ("name" "extensions"."gin_trgm_ops");



CREATE INDEX "os_skills_status_idx" ON "public"."os_skills" USING "btree" ("status");



CREATE OR REPLACE TRIGGER "os_development_request_guard_trigger" BEFORE INSERT OR UPDATE ON "public"."os_records" FOR EACH ROW EXECUTE FUNCTION "public"."os_development_request_guard"();



CREATE OR REPLACE TRIGGER "os_documents_aw" AFTER INSERT OR UPDATE ON "public"."os_documents" FOR EACH ROW EXECUTE FUNCTION "public"."os_documents_after_write"();



CREATE OR REPLACE TRIGGER "os_documents_bw" BEFORE INSERT OR UPDATE ON "public"."os_documents" FOR EACH ROW EXECUTE FUNCTION "public"."os_documents_before_write"();



CREATE OR REPLACE TRIGGER "os_documents_status_guard" BEFORE UPDATE OF "status" ON "public"."os_documents" FOR EACH ROW EXECUTE FUNCTION "public"."os_documents_block_direct_status"();



CREATE OR REPLACE TRIGGER "os_profiles_touch" BEFORE UPDATE ON "public"."os_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."os_touch_updated_at"();



CREATE OR REPLACE TRIGGER "os_records_after_write_trigger" AFTER INSERT OR UPDATE ON "public"."os_records" FOR EACH ROW EXECUTE FUNCTION "public"."os_records_after_write"();



CREATE OR REPLACE TRIGGER "os_records_before_write_trigger" BEFORE INSERT OR UPDATE ON "public"."os_records" FOR EACH ROW EXECUTE FUNCTION "public"."os_records_before_write"();



CREATE OR REPLACE TRIGGER "os_skills_aw" AFTER INSERT OR UPDATE ON "public"."os_skills" FOR EACH ROW EXECUTE FUNCTION "public"."os_skills_after_write"();



CREATE OR REPLACE TRIGGER "os_skills_bw" BEFORE INSERT OR UPDATE ON "public"."os_skills" FOR EACH ROW EXECUTE FUNCTION "public"."os_skills_before_write"();



CREATE OR REPLACE TRIGGER "os_skills_status_guard" BEFORE UPDATE OF "status", "scope" ON "public"."os_skills" FOR EACH ROW EXECUTE FUNCTION "public"."os_skills_block_direct_status"();



ALTER TABLE ONLY "public"."erp_bank_accounts"
    ADD CONSTRAINT "erp_bank_accounts_responsible_employee_id_fkey" FOREIGN KEY ("responsible_employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_card_usages"
    ADD CONSTRAINT "erp_card_usages_company_card_id_fkey" FOREIGN KEY ("company_card_id") REFERENCES "public"."erp_company_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_card_usages"
    ADD CONSTRAINT "erp_card_usages_user_employee_id_fkey" FOREIGN KEY ("user_employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_company_cards"
    ADD CONSTRAINT "erp_company_cards_responsible_employee_id_fkey" FOREIGN KEY ("responsible_employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_employment_contracts"
    ADD CONSTRAINT "erp_employment_contracts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_expenses"
    ADD CONSTRAINT "erp_expenses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_expenses"
    ADD CONSTRAINT "erp_expenses_recurring_parent_fkey" FOREIGN KEY ("recurring_parent_id") REFERENCES "public"."erp_expenses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."erp_expenses"
    ADD CONSTRAINT "erp_expenses_source_card_usage_id_fkey" FOREIGN KEY ("source_card_usage_id") REFERENCES "public"."erp_card_usages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_leave_entries"
    ADD CONSTRAINT "erp_leave_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."erp_payrolls"
    ADD CONSTRAINT "erp_payrolls_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_agent_audit_logs"
    ADD CONSTRAINT "os_agent_audit_logs_agent_key_id_fkey" FOREIGN KEY ("agent_key_id") REFERENCES "public"."os_agent_keys"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_agent_audit_logs"
    ADD CONSTRAINT "os_agent_audit_logs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."os_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_agent_audit_logs"
    ADD CONSTRAINT "os_agent_audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."os_organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_agent_audit_logs"
    ADD CONSTRAINT "os_agent_audit_logs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_agent_audit_logs"
    ADD CONSTRAINT "os_agent_audit_logs_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "public"."os_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_agent_keys"
    ADD CONSTRAINT "os_agent_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_agent_keys"
    ADD CONSTRAINT "os_agent_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."os_organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_agent_keys"
    ADD CONSTRAINT "os_agent_keys_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_channel_turns"
    ADD CONSTRAINT "os_channel_turns_saved_document_id_fkey" FOREIGN KEY ("saved_document_id") REFERENCES "public"."os_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_document_chunks"
    ADD CONSTRAINT "os_document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."os_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_document_events"
    ADD CONSTRAINT "os_document_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."os_profiles"("id");



ALTER TABLE ONLY "public"."os_document_events"
    ADD CONSTRAINT "os_document_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."os_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_document_links"
    ADD CONSTRAINT "os_document_links_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "public"."os_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_document_links"
    ADD CONSTRAINT "os_document_links_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "public"."os_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_document_versions"
    ADD CONSTRAINT "os_document_versions_agent_key_id_fkey" FOREIGN KEY ("agent_key_id") REFERENCES "public"."os_agent_keys"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_document_versions"
    ADD CONSTRAINT "os_document_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."os_profiles"("id");



ALTER TABLE ONLY "public"."os_document_versions"
    ADD CONSTRAINT "os_document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."os_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_documents"
    ADD CONSTRAINT "os_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."os_profiles"("id");



ALTER TABLE ONLY "public"."os_documents"
    ADD CONSTRAINT "os_documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."os_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_embedding_jobs"
    ADD CONSTRAINT "os_embedding_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."os_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_profiles"
    ADD CONSTRAINT "os_profiles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."erp_employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_profiles"
    ADD CONSTRAINT "os_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_profiles"
    ADD CONSTRAINT "os_profiles_password_reset_by_fkey" FOREIGN KEY ("password_reset_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_record_events"
    ADD CONSTRAINT "os_record_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_record_events"
    ADD CONSTRAINT "os_record_events_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "public"."os_records"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_records"
    ADD CONSTRAINT "os_records_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_records"
    ADD CONSTRAINT "os_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_records"
    ADD CONSTRAINT "os_records_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_records"
    ADD CONSTRAINT "os_records_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."os_records"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_records"
    ADD CONSTRAINT "os_records_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_security_audit_logs"
    ADD CONSTRAINT "os_security_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_security_audit_logs"
    ADD CONSTRAINT "os_security_audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_skill_events"
    ADD CONSTRAINT "os_skill_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."os_profiles"("id");



ALTER TABLE ONLY "public"."os_skill_events"
    ADD CONSTRAINT "os_skill_events_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."os_skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_skill_evidence"
    ADD CONSTRAINT "os_skill_evidence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."os_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_skill_evidence"
    ADD CONSTRAINT "os_skill_evidence_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."os_skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_skill_versions"
    ADD CONSTRAINT "os_skill_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."os_profiles"("id");



ALTER TABLE ONLY "public"."os_skill_versions"
    ADD CONSTRAINT "os_skill_versions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."os_skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_skills"
    ADD CONSTRAINT "os_skills_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."os_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."os_telegram_users"
    ADD CONSTRAINT "os_telegram_users_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."os_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_youtube_connections"
    ADD CONSTRAINT "os_youtube_connections_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."os_profiles"("id") ON DELETE CASCADE;



ALTER TABLE "public"."erp_bank_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_card_usages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_company_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_employment_contracts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_hr_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_leave_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_payrolls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_revenues" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_ad_performance_active_select" ON "public"."os_ad_performance_daily" FOR SELECT TO "authenticated" USING ("public"."os_is_active_member"());



ALTER TABLE "public"."os_ad_performance_daily" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."os_ad_sync_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_ad_sync_runs_admin_select" ON "public"."os_ad_sync_runs" FOR SELECT TO "authenticated" USING ("public"."os_is_admin"());



ALTER TABLE "public"."os_agent_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_agent_audit_logs_admin_select" ON "public"."os_agent_audit_logs" FOR SELECT TO "authenticated" USING ("public"."os_is_admin"());



ALTER TABLE "public"."os_agent_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_agent_keys_admin_select" ON "public"."os_agent_keys" FOR SELECT TO "authenticated" USING ("public"."os_is_admin"());



ALTER TABLE "public"."os_allowed_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_allowed_domains_admin" ON "public"."os_allowed_domains" TO "authenticated" USING ("public"."os_is_admin"()) WITH CHECK ("public"."os_is_admin"());



ALTER TABLE "public"."os_channel_turns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_channel_turns_admin_select" ON "public"."os_channel_turns" FOR SELECT TO "authenticated" USING ("public"."os_is_admin"());



ALTER TABLE "public"."os_document_chunks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_document_chunks_select" ON "public"."os_document_chunks" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_documents" "d"
  WHERE (("d"."id" = "os_document_chunks"."document_id") AND "public"."os_can_read_document"("d"."owner_id", "d"."status", "d"."team")))));



ALTER TABLE "public"."os_document_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_document_events_select" ON "public"."os_document_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_documents" "d"
  WHERE (("d"."id" = "os_document_events"."document_id") AND "public"."os_can_read_document"("d"."owner_id", "d"."status", "d"."team")))));



ALTER TABLE "public"."os_document_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_document_links_select" ON "public"."os_document_links" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_documents" "d"
  WHERE (("d"."id" = "os_document_links"."from_id") AND "public"."os_can_read_document"("d"."owner_id", "d"."status", "d"."team")))));



CREATE POLICY "os_document_links_write" ON "public"."os_document_links" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_documents" "d"
  WHERE (("d"."id" = "os_document_links"."from_id") AND (("d"."owner_id" = "auth"."uid"()) OR "public"."os_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."os_documents" "d"
  WHERE (("d"."id" = "os_document_links"."from_id") AND (("d"."owner_id" = "auth"."uid"()) OR "public"."os_is_admin"())))));



ALTER TABLE "public"."os_document_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_document_versions_select" ON "public"."os_document_versions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_documents" "d"
  WHERE (("d"."id" = "os_document_versions"."document_id") AND "public"."os_can_read_document"("d"."owner_id", "d"."status", "d"."team")))));



ALTER TABLE "public"."os_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_documents_delete" ON "public"."os_documents" FOR DELETE TO "authenticated" USING (("public"."os_is_admin"() OR (("owner_id" = "auth"."uid"()) AND ("status" = 'draft'::"public"."os_doc_status"))));



CREATE POLICY "os_documents_insert" ON "public"."os_documents" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) AND ("status" = 'draft'::"public"."os_doc_status")));



CREATE POLICY "os_documents_select" ON "public"."os_documents" FOR SELECT TO "authenticated" USING ("public"."os_can_read_document"("owner_id", "status", "team"));



CREATE POLICY "os_documents_update" ON "public"."os_documents" FOR UPDATE TO "authenticated" USING (("public"."os_is_admin"() OR (("owner_id" = "auth"."uid"()) AND ("status" <> 'canonical'::"public"."os_doc_status")) OR (("status" = 'canonical'::"public"."os_doc_status") AND (EXISTS ( SELECT 1
   FROM "public"."os_profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND "p"."is_active")))))) WITH CHECK (("public"."os_is_admin"() OR (("owner_id" = "auth"."uid"()) AND ("status" <> 'canonical'::"public"."os_doc_status")) OR (("status" = 'canonical'::"public"."os_doc_status") AND (EXISTS ( SELECT 1
   FROM "public"."os_profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND "p"."is_active"))))));



ALTER TABLE "public"."os_embedding_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."os_organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_organizations_member_select" ON "public"."os_organizations" FOR SELECT TO "authenticated" USING ("public"."os_is_active_member"());



ALTER TABLE "public"."os_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_profiles_admin_all" ON "public"."os_profiles" TO "authenticated" USING ("public"."os_is_admin"()) WITH CHECK ("public"."os_is_admin"());



CREATE POLICY "os_profiles_select" ON "public"."os_profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "os_profiles_update_self" ON "public"."os_profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK ((("id" = "auth"."uid"()) AND ("role" = "public"."os_my_role"()) AND ("is_active" = true)));



ALTER TABLE "public"."os_record_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_record_events_active_select" ON "public"."os_record_events" FOR SELECT TO "authenticated" USING ("public"."os_is_active_member"());



ALTER TABLE "public"."os_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_records_active_insert" ON "public"."os_records" FOR INSERT TO "authenticated" WITH CHECK (("public"."os_is_active_member"() AND ("created_by" = "auth"."uid"()) AND ("updated_by" = "auth"."uid"()) AND (("record_type" <> ALL (ARRAY['expense'::"text", 'contract'::"text", 'subscription'::"text", 'company_document'::"text"])) OR "public"."os_has_finance_access"())));



CREATE POLICY "os_records_active_select" ON "public"."os_records" FOR SELECT TO "authenticated" USING (("public"."os_is_active_member"() AND (("record_type" <> ALL (ARRAY['expense'::"text", 'contract'::"text", 'subscription'::"text", 'company_document'::"text"])) OR "public"."os_has_finance_access"())));



CREATE POLICY "os_records_owner_update" ON "public"."os_records" FOR UPDATE TO "authenticated" USING (("public"."os_is_active_member"() AND (("record_type" <> ALL (ARRAY['expense'::"text", 'contract'::"text", 'subscription'::"text", 'company_document'::"text"])) OR "public"."os_has_finance_access"()) AND (("created_by" = "auth"."uid"()) OR ("owner_id" = "auth"."uid"()) OR ("assignee_id" = "auth"."uid"()) OR "public"."os_is_admin"()))) WITH CHECK (("public"."os_is_active_member"() AND (("record_type" <> ALL (ARRAY['expense'::"text", 'contract'::"text", 'subscription'::"text", 'company_document'::"text"])) OR "public"."os_has_finance_access"())));



ALTER TABLE "public"."os_search_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_search_logs_admin_select" ON "public"."os_search_logs" FOR SELECT TO "authenticated" USING (("public"."os_is_admin"() OR ("actor_id" = ("auth"."uid"())::"text")));



CREATE POLICY "os_security_audit_admin_select" ON "public"."os_security_audit_logs" FOR SELECT TO "authenticated" USING ("public"."os_is_admin"());



ALTER TABLE "public"."os_security_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_security_audit_self_select" ON "public"."os_security_audit_logs" FOR SELECT TO "authenticated" USING ((("target_user_id" = "auth"."uid"()) OR ("actor_id" = "auth"."uid"())));



ALTER TABLE "public"."os_skill_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_skill_events_select" ON "public"."os_skill_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_skills" "s"
  WHERE (("s"."id" = "os_skill_events"."skill_id") AND "public"."os_can_read_skill"("s"."owner_id", "s"."scope", "s"."team")))));



ALTER TABLE "public"."os_skill_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_skill_evidence_select" ON "public"."os_skill_evidence" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_skills" "s"
  WHERE (("s"."id" = "os_skill_evidence"."skill_id") AND "public"."os_can_read_skill"("s"."owner_id", "s"."scope", "s"."team")))));



CREATE POLICY "os_skill_evidence_write" ON "public"."os_skill_evidence" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_skills" "s"
  WHERE (("s"."id" = "os_skill_evidence"."skill_id") AND (("s"."owner_id" = "auth"."uid"()) OR "public"."os_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."os_skills" "s"
  WHERE (("s"."id" = "os_skill_evidence"."skill_id") AND (("s"."owner_id" = "auth"."uid"()) OR "public"."os_is_admin"())))));



ALTER TABLE "public"."os_skill_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_skill_versions_select" ON "public"."os_skill_versions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."os_skills" "s"
  WHERE (("s"."id" = "os_skill_versions"."skill_id") AND "public"."os_can_read_skill"("s"."owner_id", "s"."scope", "s"."team")))));



ALTER TABLE "public"."os_skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_skills_delete" ON "public"."os_skills" FOR DELETE TO "authenticated" USING (("public"."os_is_admin"() OR (("owner_id" = "auth"."uid"()) AND ("status" = 'personal'::"public"."os_skill_status"))));



CREATE POLICY "os_skills_insert" ON "public"."os_skills" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) AND ("status" = 'personal'::"public"."os_skill_status") AND ("scope" = 'personal'::"public"."os_skill_scope")));



CREATE POLICY "os_skills_select" ON "public"."os_skills" FOR SELECT TO "authenticated" USING ("public"."os_can_read_skill"("owner_id", "scope", "team"));



CREATE POLICY "os_skills_update" ON "public"."os_skills" FOR UPDATE TO "authenticated" USING (("public"."os_is_admin"() OR ("owner_id" = "auth"."uid"()))) WITH CHECK (("public"."os_is_admin"() OR ("owner_id" = "auth"."uid"())));



ALTER TABLE "public"."os_telegram_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "os_telegram_users_admin_select" ON "public"."os_telegram_users" FOR SELECT TO "authenticated" USING ("public"."os_is_admin"());



CREATE POLICY "os_telegram_users_admin_update" ON "public"."os_telegram_users" FOR UPDATE TO "authenticated" USING ("public"."os_is_admin"()) WITH CHECK ("public"."os_is_admin"());



ALTER TABLE "public"."os_youtube_connections" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."os_documents" TO "anon";
GRANT ALL ON TABLE "public"."os_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."os_documents" TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_agent_archive_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_agent_archive_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_agent_create_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_agent_create_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_agent_update_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_changed_fields" "text"[], "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_agent_update_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_changed_fields" "text"[], "p_reason" "text") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."os_agent_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."os_agent_keys" TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_assert_agent_write_access"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_assert_agent_write_access"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_can_read_document"("p_owner" "uuid", "p_status" "public"."os_doc_status", "p_team" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_can_read_document"("p_owner" "uuid", "p_status" "public"."os_doc_status", "p_team" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_can_read_document"("p_owner" "uuid", "p_status" "public"."os_doc_status", "p_team" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_can_read_skill"("p_owner" "uuid", "p_scope" "public"."os_skill_scope", "p_team" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_can_read_skill"("p_owner" "uuid", "p_scope" "public"."os_skill_scope", "p_team" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_can_read_skill"("p_owner" "uuid", "p_scope" "public"."os_skill_scope", "p_team" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_claim_embedding_job"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_claim_embedding_job"() TO "service_role";



GRANT ALL ON TABLE "public"."os_records" TO "authenticated";
GRANT ALL ON TABLE "public"."os_records" TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_decide_leave_request"("p_request_id" "uuid", "p_expected_version" integer, "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_decide_leave_request"("p_request_id" "uuid", "p_expected_version" integer, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_decide_leave_request"("p_request_id" "uuid", "p_expected_version" integer, "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_development_request_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_development_request_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_documents_after_write"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_documents_after_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_documents_before_write"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_documents_before_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_documents_block_direct_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_documents_block_direct_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_finish_embedding_job"("p_job_id" bigint, "p_chunks" "jsonb", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_finish_embedding_job"("p_job_id" bigint, "p_chunks" "jsonb", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_get_document_versions"("p_document_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_get_document_versions"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_get_document_versions"("p_document_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."os_has_finance_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_has_finance_access"() TO "service_role";



GRANT ALL ON FUNCTION "public"."os_is_active_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_is_active_member"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_is_lead_or_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_is_lead_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_is_lead_or_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_list_documents_v3"("p_limit" integer, "p_offset" integer, "p_statuses" "public"."os_doc_status"[], "p_owner" "uuid", "p_folder_prefix" "text", "p_query" "text", "p_include_content" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_list_documents_v3"("p_limit" integer, "p_offset" integer, "p_statuses" "public"."os_doc_status"[], "p_owner" "uuid", "p_folder_prefix" "text", "p_query" "text", "p_include_content" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_list_documents_v3"("p_limit" integer, "p_offset" integer, "p_statuses" "public"."os_doc_status"[], "p_owner" "uuid", "p_folder_prefix" "text", "p_query" "text", "p_include_content" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_my_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_my_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_my_team"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_my_team"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_my_team"() TO "service_role";



GRANT ALL ON FUNCTION "public"."os_records_after_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_records_after_write"() TO "service_role";



GRANT ALL ON FUNCTION "public"."os_records_before_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_records_before_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_restore_document_version"("p_document_id" "uuid", "p_version_no" integer, "p_expected_version" integer, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_restore_document_version"("p_document_id" "uuid", "p_version_no" integer, "p_expected_version" integer, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_restore_document_version"("p_document_id" "uuid", "p_version_no" integer, "p_expected_version" integer, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_rollback_document"("p_document_id" "uuid", "p_version_no" integer, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_rollback_document"("p_document_id" "uuid", "p_version_no" integer, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_rollback_document"("p_document_id" "uuid", "p_version_no" integer, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_search_documents"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_search_documents"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_search_documents"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_search_knowledge"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text", "p_min_score" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_search_knowledge"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text", "p_min_score" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_search_knowledge"("p_query" "text", "p_embedding" "extensions"."vector", "p_limit" integer, "p_statuses" "public"."os_doc_status"[], "p_folder" "text", "p_brand" "text", "p_min_score" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_set_document_status"("p_document_id" "uuid", "p_to" "public"."os_doc_status", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_set_document_status"("p_document_id" "uuid", "p_to" "public"."os_doc_status", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_set_document_status"("p_document_id" "uuid", "p_to" "public"."os_doc_status", "p_note" "text") TO "service_role";



GRANT ALL ON TABLE "public"."os_skills" TO "anon";
GRANT ALL ON TABLE "public"."os_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."os_skills" TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_set_skill_status"("p_skill_id" "uuid", "p_to" "public"."os_skill_status", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_set_skill_status"("p_skill_id" "uuid", "p_to" "public"."os_skill_status", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_set_skill_status"("p_skill_id" "uuid", "p_to" "public"."os_skill_status", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_skills_after_write"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_skills_after_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_skills_before_write"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_skills_before_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_skills_block_direct_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_skills_block_direct_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_touch_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_touch_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."os_update_document"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."os_update_document"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_update_document"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_content_md" "text", "p_folder" "text", "p_brand" "text", "p_team" "text", "p_tags" "text"[], "p_reason" "text") TO "service_role";



GRANT ALL ON TABLE "public"."erp_bank_accounts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_bank_accounts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_bank_accounts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_bank_accounts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_card_usages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_card_usages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_card_usages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_card_usages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_company_cards" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_company_cards_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_company_cards_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_company_cards_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_employees" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_employees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_employees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_employees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_employment_contracts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_employment_contracts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_employment_contracts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_employment_contracts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_expenses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_expenses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_expenses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_expenses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_hr_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_hr_settings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_hr_settings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_hr_settings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_leave_entries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_leave_entries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_leave_entries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_leave_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_payrolls" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_payrolls_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_payrolls_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_payrolls_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."erp_revenues" TO "service_role";



GRANT ALL ON SEQUENCE "public"."erp_revenues_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."erp_revenues_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."erp_revenues_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."os_ad_performance_daily" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."os_ad_performance_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."os_ad_performance_daily" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."os_ad_sync_runs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."os_ad_sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."os_ad_sync_runs" TO "service_role";



GRANT ALL ON TABLE "public"."os_agent_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."os_agent_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."os_agent_audit_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_agent_audit_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_agent_audit_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_agent_audit_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_allowed_domains" TO "anon";
GRANT ALL ON TABLE "public"."os_allowed_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."os_allowed_domains" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."os_channel_turns" TO "authenticated";
GRANT ALL ON TABLE "public"."os_channel_turns" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_channel_turns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_channel_turns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_channel_turns_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_document_chunks" TO "anon";
GRANT ALL ON TABLE "public"."os_document_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."os_document_chunks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_document_chunks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_document_chunks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_document_chunks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_document_events" TO "anon";
GRANT ALL ON TABLE "public"."os_document_events" TO "authenticated";
GRANT ALL ON TABLE "public"."os_document_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_document_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_document_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_document_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_document_links" TO "anon";
GRANT ALL ON TABLE "public"."os_document_links" TO "authenticated";
GRANT ALL ON TABLE "public"."os_document_links" TO "service_role";



GRANT ALL ON TABLE "public"."os_document_versions" TO "anon";
GRANT ALL ON TABLE "public"."os_document_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."os_document_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_document_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_document_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_document_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_embedding_jobs" TO "anon";
GRANT ALL ON TABLE "public"."os_embedding_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."os_embedding_jobs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_embedding_jobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_embedding_jobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_embedding_jobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_organizations" TO "anon";
GRANT ALL ON TABLE "public"."os_organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."os_organizations" TO "service_role";



GRANT ALL ON TABLE "public"."os_profiles" TO "anon";
GRANT ALL ON TABLE "public"."os_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."os_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."os_record_events" TO "authenticated";
GRANT ALL ON TABLE "public"."os_record_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_record_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_record_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_record_events_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."os_search_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."os_search_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_search_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_search_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_search_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_security_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."os_security_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."os_security_audit_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_security_audit_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_security_audit_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_security_audit_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_skill_events" TO "anon";
GRANT ALL ON TABLE "public"."os_skill_events" TO "authenticated";
GRANT ALL ON TABLE "public"."os_skill_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_skill_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_skill_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_skill_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_skill_evidence" TO "anon";
GRANT ALL ON TABLE "public"."os_skill_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."os_skill_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."os_skill_versions" TO "anon";
GRANT ALL ON TABLE "public"."os_skill_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."os_skill_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."os_skill_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."os_skill_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."os_skill_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."os_telegram_users" TO "anon";
GRANT ALL ON TABLE "public"."os_telegram_users" TO "authenticated";
GRANT ALL ON TABLE "public"."os_telegram_users" TO "service_role";



GRANT ALL ON TABLE "public"."os_youtube_connections" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




