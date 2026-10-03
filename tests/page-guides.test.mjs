import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PAGE_GUIDES,guideClosedKey} from '../lib/page-guides.ts';
import {NAV_STAGES,ACCOUNT_PAGE,findPage} from '../lib/navigation.ts';
test('all 23 menus and account have three exact handoff steps and a live next route',()=>{
  assert.equal(Object.keys(PAGE_GUIDES).length,24);
  const spec=readFileSync('docs/handoff/os-final-20261003/02_UIUX_기획서.md','utf8');
  for(const page of [...NAV_STAGES.flatMap(stage=>stage.pages),ACCOUNT_PAGE]){
    const guide=PAGE_GUIDES[page.href];assert.ok(guide,page.href);assert.equal(guide.steps.length,3);
    for(const step of guide.steps)assert.ok(spec.includes(step),step);
    assert.ok(PAGE_GUIDES[findPage(guide.next).href],guide.next);
  }
  assert.notEqual(guideClosedKey('/knowledge'),guideClosedKey('/knowledge/search'));
});
