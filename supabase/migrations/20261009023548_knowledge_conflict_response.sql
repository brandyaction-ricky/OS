-- Business version conflicts are not transient database serialization failures.
-- PostgREST 14 can retry SQLSTATE 40001 indefinitely; PT409 returns immediately.
-- Preserve each installed function's body, security attributes and grants except
-- for this error code. No data, policy, signature or other-menu function changes.
do $migration$
declare signature text; original text; patched text;
begin
  foreach signature in array array[
    'public.os_submit_candidate(uuid,integer,uuid,text,uuid,date)',
    'public.os_decide_candidate(uuid,integer,text,text)',
    'public.os_keep_canon_review(uuid,integer)',
    'public.os_knowledge_command(jsonb)',
    'public.os_knowledge_workflow_command(jsonb)',
    'public.os_set_document_steward(uuid,uuid,integer,uuid)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'KNOWLEDGE_CONFLICT_PREREQUISITE_MISSING: %', signature;
    end if;
    select pg_get_functiondef(to_regprocedure(signature)) into original;
    patched := regexp_replace(original, 'errcode\s*=\s*''40001''', 'errcode = ''PT409''', 'gi');
    if original = patched and position('PT409' in original) = 0 then
      raise exception 'KNOWLEDGE_CONFLICT_DEFINITION_UNEXPECTED: %', signature;
    end if;
    execute patched;
  end loop;
end $migration$;
