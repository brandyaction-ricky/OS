-- Record only the already-applied quota change; do not replay the baseline.
-- Run only after environment-specific approval and a live-definition review.
DO $history$
DECLARE
  definition text := pg_get_functiondef('public.os_assert_agent_write_access(uuid,uuid,text)'::regprocedure);
  migration_sql text := $payload$-- Raise only knowledge.update's rolling 24-hour quota (200 -> 1000).
-- Keep minute/create/delete limits, authorization, locking and audit counting intact.
-- Abort on an unexpected deployed definition rather than replacing other changes.
DO $migration$
DECLARE
  definition text;
  old_rule constant text := 'v_day_limit integer := case when p_action = ''knowledge.delete'' then 30 else 200 end;';
  new_rule constant text := 'v_day_limit integer := case when p_action = ''knowledge.delete'' then 30 when p_action = ''knowledge.update'' then 1000 else 200 end;';
BEGIN
  definition := pg_get_functiondef('public.os_assert_agent_write_access(uuid,uuid,text)'::regprocedure);
  IF strpos(definition, new_rule) > 0 THEN
    RETURN;
  END IF;
  IF strpos(definition, old_rule) = 0
     OR (length(definition) - length(replace(definition, old_rule, ''))) <> length(old_rule) THEN
    RAISE EXCEPTION 'Unexpected agent quota definition; inspect before applying';
  END IF;
  EXECUTE replace(definition, old_rule, new_rule);
END;
$migration$;
$payload$;
  existing supabase_migrations.schema_migrations%ROWTYPE;
BEGIN
  IF strpos(definition, 'v_day_limit integer := case when p_action = ''knowledge.delete'' then 30 when p_action = ''knowledge.update'' then 1000 else 200 end;') = 0
     OR strpos(definition, 'v_minute_limit integer := case when p_action = ''knowledge.delete'' then 5 else 20 end;') = 0 THEN
    RAISE EXCEPTION 'Quota change not verified; refusing to record application';
  END IF;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('20260921140000', 'agent_update_daily_limit', ARRAY[migration_sql])
  ON CONFLICT (version) DO NOTHING;
  SELECT * INTO existing FROM supabase_migrations.schema_migrations WHERE version = '20260921140000';
  IF existing.name IS DISTINCT FROM 'agent_update_daily_limit'
     OR existing.statements IS DISTINCT FROM ARRAY[migration_sql] THEN
    RAISE EXCEPTION 'Existing migration entry differs; no history overwritten';
  END IF;
END;
$history$;

SELECT version, name, cardinality(statements) AS statement_count
FROM supabase_migrations.schema_migrations WHERE version = '20260921140000';

