import test from 'node:test';
import assert from 'node:assert/strict';
import {isLegacyTeamDocument,legacyFolders,inKnowledgeFolder,LEGACY_KNOWLEDGE_CUTOVER} from '../lib/knowledge/legacy.ts';
import {filterReadable} from '../lib/knowledge/access.ts';

const legacy={id:'legacy',created_at:'2026-09-01T00:00:00Z',status:'draft',source:'obsidian_vault',owner_id:'owner',folder:'회사/자료',content_md:'unchanged',current_version:39};
test('all legacy sources appear in team discovery without changing approval or permissions',()=>{
  for(const source of ['obsidian_vault','markdown','mcp','google_sheets','wiki','meeting_raw']){
    const doc={...legacy,source},before=structuredClone(doc);
    assert.equal(isLegacyTeamDocument(doc),true);assert.deepEqual(doc,before);
  }
  for(const status of ['canonical','archived'])assert.equal(isLegacyTeamDocument({...legacy,status}),false);
  assert.equal(isLegacyTeamDocument({...legacy,meeting_record_id:'private-meeting'}),false);
  for(const created_at of [LEGACY_KNOWLEDGE_CUTOVER,'2026-10-10T00:00:00Z','invalid',''])assert.equal(isLegacyTeamDocument({...legacy,created_at}),false);
});
test('legacy discovery never widens private, partner or inactive access',()=>{
  const owner={ownerId:'owner',type:'user',role:'member',memberKind:'staff',active:true,allowedStatuses:['draft','team','canonical']};
  const list=actor=>filterReadable(actor,[legacy]).filter(isLegacyTeamDocument);
  assert.equal(list(owner).length,1);
  for(const actor of [{...owner,ownerId:'peer'},{...owner,ownerId:'admin',role:'admin'},{...owner,ownerId:'partner',memberKind:'partner'},{...owner,active:false}])assert.equal(list(actor).length,0);
});
test('legacy folders preserve exact nested paths and subtree counts',()=>{
  const docs=[legacy,{...legacy,folder:'회사/자료/기록'},{...legacy,folder:'회사/자료2'}, {...legacy,folder:''}];
  assert.deepEqual(legacyFolders(docs),[{path:'회사',count:3},{path:'회사/자료',count:2},{path:'회사/자료/기록',count:1},{path:'회사/자료2',count:1}]);
  assert.equal(docs.filter(d=>inKnowledgeFolder(d,'회사/자료')).length,2);
  assert.equal(docs.filter(d=>inKnowledgeFolder(d,'')).length,4);
  const absolute={folder:'/자료/원본'};
  assert.deepEqual(legacyFolders([absolute]),[{path:'/자료',count:1},{path:'/자료/원본',count:1}]);
  assert.equal(inKnowledgeFolder(absolute,legacyFolders([absolute])[0].path),true);
});
