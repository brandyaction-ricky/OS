import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PAGE_GUIDES,guideClosedKey} from '../lib/page-guides.ts';
import {NAV_STAGES,ACCOUNT_PAGE,findPage} from '../lib/navigation.ts';
test('all 23 menus and account have three reviewed steps and a live next route',()=>{
  assert.equal(Object.keys(PAGE_GUIDES).length,24);
  // The approved guide snapshot is independent of private source documents.
  const snapshot=JSON.stringify(Object.entries(PAGE_GUIDES).sort(([a],[b])=>a.localeCompare(b)));
  assert.equal(createHash('sha256').update(snapshot).digest('hex'),'58b290aff3b828a4d1a32f7c3dc0a5b6d76616451e9ee27d8617c7ee7cf20a7f');
  for(const page of [...NAV_STAGES.flatMap(stage=>stage.pages),ACCOUNT_PAGE]){
    const guide=PAGE_GUIDES[page.href];assert.ok(guide,page.href);assert.equal(guide.steps.length,3);
    for(const step of guide.steps)assert.ok(typeof step==='string'&&step.trim().length>0,page.href);
    assert.equal(new Set(guide.steps).size,3,page.href);
    assert.ok(PAGE_GUIDES[findPage(guide.next).href],guide.next);
  }
  assert.notEqual(guideClosedKey('/knowledge'),guideClosedKey('/knowledge/search'));
});
