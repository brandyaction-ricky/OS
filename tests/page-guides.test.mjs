import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PAGE_GUIDES,guideClosedKey} from '../lib/page-guides.ts';
import {NAV_STAGES,ACCOUNT_PAGE,findPage} from '../lib/navigation.ts';
test('all current menus and account have three reviewed steps and a live next route',()=>{
  assert.equal(Object.keys(PAGE_GUIDES).length,58);
  // Reviewed topic planning now ends at the chosen channel, not a fixed card-news route.
  // Preserve the remaining guide snapshot while checking all new guides below (2026-10-28: 검수 요청 → 검토 요청, AI 키 → 연결 키, plain-words pass).
  const snapshot=JSON.stringify(Object.entries(PAGE_GUIDES).filter(([path])=>!path.startsWith('/finance/')&&!path.startsWith('/hr/')&&!['/automation/references','/content/video','/knowledge/vault','/knowledge/notes','/knowledge/meetings','/knowledge/decisions','/knowledge/docs','/knowledge/canon','/knowledge/graph','/knowledge/templates','/knowledge/trash'].includes(path)).sort(([a],[b])=>a.localeCompare(b)));
  assert.equal(createHash('sha256').update(snapshot).digest('hex'),'085d948b8fe434488da4926170e8cafd464ede093076c2bfbcd807a22b576699');
  for(const page of [...NAV_STAGES.flatMap(stage=>stage.pages),ACCOUNT_PAGE]){
    const guide=PAGE_GUIDES[page.href];assert.ok(guide,page.href);assert.equal(guide.steps.length,3);
    for(const step of guide.steps)assert.ok(typeof step==='string'&&step.trim().length>0,page.href);
    assert.equal(new Set(guide.steps).size,3,page.href);
    assert.ok(PAGE_GUIDES[findPage(guide.next).href],guide.next);
  }
  assert.notEqual(guideClosedKey('/knowledge'),guideClosedKey('/knowledge/search'));
});
