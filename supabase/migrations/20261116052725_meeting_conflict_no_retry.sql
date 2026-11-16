-- A stale optimistic version is a permanent conflict, not a serialization retry.
-- PostgREST 14 retries 40001 indefinitely. Preserve every authorization check,
-- function attribute and grant; change only the reviewed conflict SQLSTATE.
-- Abort on a concurrently changed definition rather than replacing another release.
do $migration$
declare
  target record;
  fn oid;
  before_source text;
  after_source text;
  definition text;
  needle constant text := 'raise exception ''OS_VERSION_CONFLICT'' using errcode=''40001''';
  replacement constant text := 'raise exception ''OS_VERSION_CONFLICT'' using errcode=''PT409''';
begin
  for target in select * from (values
    ('public.os_team_command(jsonb)', '8c0537d6cea26b366be82255bb860787', 4),
    ('public.os_team_archive_meeting(uuid,integer,text)', '92c6c9b8df4f4b98264c99251efaa014', 1)
  ) as targets(signature, original_hash, occurrences)
  loop
    fn := to_regprocedure(target.signature);
    if fn is null then raise exception 'MEETING_CONFLICT_FUNCTION_MISSING: %', target.signature; end if;
    select prosrc into before_source from pg_proc where oid=fn;
    -- Allow a verified second application, but never reinterpret unrelated edits.
    if md5(replace(before_source, replacement, needle)) <> target.original_hash then
      raise exception 'MEETING_CONFLICT_DEFINITION_CHANGED: %', target.signature;
    end if;
    if (length(before_source)-length(replace(before_source,needle,'')))/length(needle) = 0 then
      if (length(before_source)-length(replace(before_source,replacement,'')))/length(replacement) <> target.occurrences then
        raise exception 'MEETING_CONFLICT_PATCH_COUNT: %', target.signature;
      end if;
      continue;
    end if;
    if (length(before_source)-length(replace(before_source,needle,'')))/length(needle) <> target.occurrences then
      raise exception 'MEETING_CONFLICT_PATCH_COUNT: %', target.signature;
    end if;
    after_source := replace(before_source,needle,replacement);
    definition := replace(pg_get_functiondef(fn),needle,replacement);
    execute definition;
    if (select prosrc from pg_proc where oid=fn) is distinct from after_source then
      raise exception 'MEETING_CONFLICT_PATCH_VERIFY: %', target.signature;
    end if;
  end loop;
end
$migration$;
