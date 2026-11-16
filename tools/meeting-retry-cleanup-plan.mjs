// Generates (never executes) a narrowly scoped recovery SQL file.
// A separate production approval and fresh Postgres log evidence are required.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const iso=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/;
export function cleanupSql(plan,now=Date.now()) {
  if(!plan || !Array.isArray(plan.sessions) || !plan.sessions.length || plan.sessions.length>10) throw new Error('Provide 1–10 individually confirmed sessions');
  const seen=new Set();
  const rows=plan.sessions.map(s=>{
    if(!Number.isSafeInteger(s.pid)||s.pid<=0||seen.has(s.pid))throw new Error('Invalid or duplicate PID');
    seen.add(s.pid);
    if(!iso.test(s.backendStart)||!Number.isFinite(Date.parse(s.backendStart)))throw new Error('Exact backend start required');
    if(s.user!=='authenticator'||s.application!=='PostgREST 14.5'||s.rpc!=='public.os_team_command(jsonb)')throw new Error('Unexpected backend');
    if(!/^-?\d{1,20}$/.test(s.queryId))throw new Error('Query ID required');
    if(!Array.isArray(s.errors)||s.errors.length<2)throw new Error('Repeated error evidence required');
    const times=s.errors.map(e=>{
      if(e.pid!==s.pid||e.code!=='40001'||e.message!=='OS_VERSION_CONFLICT'||e.context!=='public.os_team_command(jsonb)'||!iso.test(e.at))throw new Error('Mismatched log evidence');
      const t=Date.parse(e.at);if(!Number.isFinite(t)||t>now||now-t>60_000||t<Date.parse(s.backendStart))throw new Error('Use fresh log evidence (last 60 seconds)');return t;
    });
    if(new Set(times).size<2)throw new Error('Two distinct errors required');
    return `(${s.pid},'${s.backendStart}'::timestamptz,${s.queryId}::bigint)`;
  });
  return `-- PREPARED ONLY: do not execute without separate production approval.
-- Terminates only matching looping sessions; the affected request rolls back.
begin;
set local statement_timeout='5s';
set local lock_timeout='1s';
do $guard$
begin
  if clock_timestamp() > '${new Date(now+60_000).toISOString()}'::timestamptz then
    raise exception 'CLEANUP_PLAN_EXPIRED';
  end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.os_team_command(jsonb)')
    and prosrc not like '%40001%' and prosrc like '%PT409%') then
    raise exception 'PATCH_MEETING_CONFLICT_FIRST';
  end if;
end $guard$;
with confirmed(pid,backend_start,query_id) as (values ${rows.join(',\n')})
select a.pid,pg_terminate_backend(a.pid) as terminated
from pg_stat_activity a join confirmed c using(pid,backend_start,query_id)
where a.pid<>pg_backend_pid() and a.datname=current_database()
  and a.usename='authenticator' and a.application_name='PostgREST 14.5'
  and a.state='active' and a.backend_type='client backend'
  and a.query like '%"public"."os_team_command"%';
commit;
-- If zero rows match, stop and recheck; do not broaden the selector or restart the project.
`;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const [planPath,outputPath,...rest]=process.argv.slice(2);
  if(!planPath||!outputPath||rest.length)throw new Error('Usage: node tools/meeting-retry-cleanup-plan.mjs confirmed-plan.json output.sql');
  writeFileSync(outputPath,cleanupSql(JSON.parse(readFileSync(planPath,'utf8'))),{flag:'wx',mode:0o600});
  console.log('Prepared only; no database connection or termination performed.');
}
