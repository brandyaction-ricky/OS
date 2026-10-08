import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PAGE_GUIDES,guideClosedKey} from '../lib/page-guides.ts';
import {NAV_STAGES,ACCOUNT_PAGE,findPage} from '../lib/navigation.ts';
test('all company and existing menus and account have three reviewed steps and a live next route',()=>{
  assert.equal(Object.keys(PAGE_GUIDES).length,47);
  // YouTube management hands its kit to publishing; comments remain a separate group.
  const snapshot=JSON.stringify(Object.entries(PAGE_GUIDES).filter(([path])=>!path.startsWith('/finance/')&&!['/knowledge/notes','/knowledge/meetings','/knowledge/decisions','/knowledge/docs','/knowledge/canon','/knowledge/graph','/knowledge/templates','/knowledge/trash'].includes(path)).sort(([a],[b])=>a.localeCompare(b)));
  assert.equal(createHash('sha256').update(snapshot).digest('hex'),'842353e6d79329088e538f6c9bdb197ac66d3a90063b53b3143e51bcc1b5364d');
  for(const page of [...NAV_STAGES.flatMap(stage=>stage.pages),ACCOUNT_PAGE]){
    const guide=PAGE_GUIDES[page.href];assert.ok(guide,page.href);assert.equal(guide.steps.length,3);
    for(const step of guide.steps)assert.ok(typeof step==='string'&&step.trim().length>0,page.href);
    assert.equal(new Set(guide.steps).size,3,page.href);
    assert.ok(PAGE_GUIDES[findPage(guide.next).href],guide.next);
  }
  assert.notEqual(guideClosedKey('/knowledge'),guideClosedKey('/knowledge/search'));
});
