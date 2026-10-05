import test from 'node:test';
import assert from 'node:assert/strict';
import {workTopics,workTopicSelection,defaultsToAll,workTopicHref} from '../lib/content-work-context.ts';
const rows=[{id:'own',record_type:'content_topic',title:'Our video',metadata:{}},{id:'another',record_type:'content_topic',title:'Second',metadata:{}},{id:'market',record_type:'content_topic',title:'Reference',metadata:{studioKind:'outlier'}},{id:'test',record_type:'content_topic',title:'[테스트] Fixture',metadata:{}},{id:'archive',record_type:'content_topic',title:'Old',archived_at:'2026-01-01',metadata:{}}];
test('shared selection only offers own, active topics',()=>{assert.deepEqual(workTopics(rows).map(r=>r.id),['own','another']);});
test('URL wins over storage and inaccessible sources never silently select another',()=>{
  assert.equal(workTopicSelection(rows,'own','another',false),'own');
  for(const id of ['market','test','archive','missing','all'])assert.equal(workTopicSelection(rows,id,'own',false),'');
  assert.equal(workTopicSelection(rows,null,'another',false),'another');
  assert.equal(workTopicSelection(rows,null,'missing',false),'own');
});
test('overview screens start with all videos while explicit selections survive every stage',()=>{
  for(const path of ['/content/comments','/content/performance','/content/calendar'])assert.ok(defaultsToAll(path,null));
  assert.ok(defaultsToAll('/content/publishing','calendar'));assert.ok(!defaultsToAll('/content/scripts',null));
  assert.equal(workTopicSelection(rows,null,'own',true),'');
  assert.equal(workTopicSelection(rows,'own','',true),'own');
  assert.equal(workTopicHref('/content/publishing?tab=calendar&sourceId=old','own'),'/content/publishing?tab=calendar&topic=own');
});
