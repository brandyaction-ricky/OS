import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PAGE_GUIDES,guideClosedKey} from '../lib/page-guides.ts';
import {NAV_STAGES,ACCOUNT_PAGE,findPage} from '../lib/navigation.ts';
test('all current menus and account have three reviewed steps and a live next route',()=>{
  assert.equal(Object.keys(PAGE_GUIDES).length,60);
  // UX-10: current Threads topic planning proceeds to its writing step.
  // Preserve the remaining guide snapshot while checking all new guides below (2026-10-28: 검수 요청 → 검토 요청, AI 키 → 연결 키, plain-words pass).
  // 2026-10-29: approved Threads now dispatch through the official API after account/text confirmation.
  const snapshot=JSON.stringify(Object.entries(PAGE_GUIDES).filter(([path])=>!path.startsWith('/finance/')&&!path.startsWith('/hr/')&&!['/content/images','/automation/references','/content/video','/knowledge/vault','/knowledge/notes','/knowledge/meetings','/knowledge/decisions','/knowledge/docs','/knowledge/canon','/knowledge/graph','/knowledge/templates','/knowledge/trash'].includes(path)).sort(([a],[b])=>a.localeCompare(b)));
  assert.equal(createHash('sha256').update(snapshot).digest('hex'),'da3a5460dd2db7298acb36547f8369c2fd5a699c74268bdb909934d93b12ffb2');
  assert.equal(PAGE_GUIDES["/automation/topics"].next,"/automation/threads");
  for(const page of [...NAV_STAGES.flatMap(stage=>stage.pages),ACCOUNT_PAGE]){
    const guide=PAGE_GUIDES[page.href];assert.ok(guide,page.href);assert.equal(guide.steps.length,3);
    for(const step of guide.steps)assert.ok(typeof step==='string'&&step.trim().length>0,page.href);
    assert.equal(new Set(guide.steps).size,3,page.href);
    assert.ok(PAGE_GUIDES[findPage(guide.next).href],guide.next);
  }
  assert.notEqual(guideClosedKey('/knowledge'),guideClosedKey('/knowledge/search'));
});
