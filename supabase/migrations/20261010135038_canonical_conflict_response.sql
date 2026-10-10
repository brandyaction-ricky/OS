-- Keep canonical review conflicts compatible with the existing PostgREST 14
-- response contract. The publication gate was installed after the earlier
-- conflict-response migration and introduced two new 40001 errors.
-- Preserve installed function bodies, privileges and document data.
do $migration$
declare signature text; original text; patched text;
begin
  foreach signature in array array[
    'public.os_decide_candidate(uuid,integer,text,text)',
    'public.os_publish_candidate(uuid,integer)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'CANONICAL_CONFLICT_PREREQUISITE_MISSING: %', signature;
    end if;
    select pg_get_functiondef(to_regprocedure(signature)) into original;
    patched := regexp_replace(original, 'errcode\s*=\s*''40001''', 'errcode = ''PT409''', 'gi');
    if original = patched then
      raise exception 'CANONICAL_CONFLICT_DEFINITION_UNEXPECTED: %', signature;
    end if;
    execute patched;
  end loop;
end $migration$;
