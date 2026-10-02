import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { safeLoginRedirect } from '../lib/login-redirect.ts';
import { decodeHtmlEntities } from '../lib/html-entities.ts';
import { contentOrigin, filterContentOrigin, sourceSelection, linkedContentOrigin } from '../lib/content-origin.ts';
import { agentKeyPolicy, defaultAgentExpiry, agentKeyAccessLabel } from '../lib/agent-key-policy.ts';
import { canAgentWriteDocument, agentReadableStatuses, canReadKnowledgeDocument } from '../lib/server/document-access.ts';

test('login redirects preserve internal query/hash and reject normalization bypasses', () => {
  for (const value of ['https://outside.test', '//outside.test', '/\\outside.test', '/%5coutside.test', '/%2foutside.test', '/a/..//outside.test', '/%2e%2e//outside.test', '/\n/outside.test', 'javascript:alert(1)', ' /home', '/%ZZ', null]) assert.equal(safeLoginRedirect(value), '/home', String(value));
  for (const value of ['/knowledge?document=fixture#heading', '/knowledge/search?q=hello%20world', '/home', '/content/topics?tab=planning']) assert.equal(safeLoginRedirect(value), value);
});
test('entities become plain characters without interpreting tags or invalid code points', () => {
  assert.equal(decodeHtmlEntities('&quot;제목&quot; &#39;원고&#39; &amp; 근거'), '"제목" \'원고\' & 근거');
  assert.equal(decodeHtmlEntities('&#x1F600; &lt;script&gt;'), '😀 <script>');
  assert.equal(decodeHtmlEntities('&#0; &#xD800; &#1114112; &unknown;'), '&#0; &#xD800; &#1114112; &unknown;');
  assert.equal(decodeHtmlEntities('&amp;quot;'), '&quot;');
});
const own = { id:'own', title:'내 기획', metadata:{ studioKind:'niche' } }, market = { id:'market', title:'시장', metadata:{ studioKind:'outlier' } }, qa = { id:'test', title:'[QA테스트] 콘텐츠', metadata:{} };
test('source default excludes market/test while explicit filters retain access', () => {
  assert.deepEqual(filterContentOrigin([market,qa,own]),[own]);
  assert.deepEqual(filterContentOrigin([market,qa,own],'market'),[market]);
  assert.deepEqual(filterContentOrigin([market,qa,own],'test'),[qa]);
  assert.equal(filterContentOrigin([market,qa,own],'all').length,3);
  assert.equal(sourceSelection([market,qa,own],'','market'),'own');
  assert.equal(contentOrigin({metadata:{origin:'own',studioKind:'outlier'}}),'own');
  assert.equal(contentOrigin({metadata:{packageKind:'market_reference'}}),'market');
  assert.equal(linkedContentOrigin({parent_id:'test',metadata:{}},[qa]),'test');
});
test('draft-writing keys read company references but cannot update or archive canonical documents', () => {
  const policy = agentKeyPolicy('draft');
  const actor = {type:'agent',role:'member',ownerId:'owner',writableStatuses:policy.allowedStatuses,allowedStatuses:agentReadableStatuses(policy.allowedStatuses,true)};
  assert.equal(canReadKnowledgeDocument(actor,{owner_id:'someone-else',status:'canonical'}),true);
  assert.equal(canAgentWriteDocument(actor,'canonical'),false);
  assert.equal(canAgentWriteDocument(actor,'draft'),true);
  assert.equal(canAgentWriteDocument({...actor,writableStatuses:agentKeyPolicy('write').allowedStatuses},'canonical'),true);
  assert.equal(agentKeyPolicy('read').scopes.includes('knowledge.write'),false);
  assert.equal(agentKeyAccessLabel({scopes:['knowledge.write'],allowed_statuses:['canonical'],enforce_write_statuses:false}),'읽기·쓰기 (기존)');
  assert.equal(defaultAgentExpiry(new Date('2026-10-03T00:00:00Z')),'2027-01-01');
});
test('offline cleanup defaults to counts, never mutates input, and rejects apply', async () => {
  const dir=await mkdtemp(join(tmpdir(),'os-hygiene-'));
  try {
    const path=join(dir,'records.json'), payload=JSON.stringify([{...qa,title:'[테스트] &quot;비공개 제목&quot;',version:1}]); await writeFile(path,payload);
    const output=execFileSync(process.execPath,['tools/content-hygiene.mjs','--input',path],{encoding:'utf8'});
    assert.deepEqual(JSON.parse(output),{dryRun:true,scanned:1,testCandidates:1,entityTitles:1,changes:1,planWritten:false});
    assert.doesNotMatch(output,/비공개|test"|patch/); assert.equal(await readFile(path,'utf8'),payload);
    assert.throws(()=>execFileSync(process.execPath,['tools/content-hygiene.mjs','--input',path,'--apply'],{stdio:'pipe'}));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
