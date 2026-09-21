-- Raise only knowledge.update's rolling 24-hour quota (200 -> 1000).
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
