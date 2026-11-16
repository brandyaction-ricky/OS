import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupSql} from '../tools/meeting-retry-cleanup-plan.mjs';
const now=Date.parse('2026-11-16T06:00:00Z');
function plan(){return {sessions:[{pid:123,backendStart:'2026-11-16T05:00:00Z',queryId:'456',user:'authenticator',application:'PostgREST 14.5',rpc:'public.os_team_command(jsonb)',errors:[10,20].map(seconds=>({pid:123,code:'40001',message:'OS_VERSION_CONFLICT',context:'public.os_team_command(jsonb)',at:new Date(now-seconds*1000).toISOString()}))}]};}
test('cleanup is restricted to confirmed connection identity and requires deployed fix',()=>{
  const sql=cleanupSql(plan(),now);
  assert.match(sql,/using\(pid,backend_start,query_id\)/);
  assert.match(sql,/PATCH_MEETING_CONFLICT_FIRST/);assert.match(sql,/CLEANUP_PLAN_EXPIRED/);
  assert.match(sql,/a.state='active'/);assert.match(sql,/a.usename='authenticator'/);
});
test('old logs, unrelated failures, reused PID identity and unconfirmed connections are refused',()=>{
  for(const change of [p=>p.sessions[0].errors.splice(1),p=>p.sessions[0].errors[0].at='2026-11-16T05:00:00Z',p=>p.sessions[0].errors[0].pid=999,p=>p.sessions[0].errors[0].code='57014',p=>p.sessions[0].user='postgres',p=>p.sessions[0].queryId='1);select 1;--',p=>p.sessions[0].backendStart='2026-11-16T05:59:55Z',p=>p.sessions.push(p.sessions[0])]){
    const p=plan();change(p);assert.throws(()=>cleanupSql(p,now));
  }
});
