// Browser rendering benchmark over the real local graph, scoped to synthetic fixtures.
import assert from 'node:assert/strict';
import { chromium, expect as baseExpect } from '@playwright/test';
import { accounts, appUrl, localEnvironment } from '../../tools/knowledge-local-qa.mjs';
const local=localEnvironment(),users=await accounts(local),expect=baseExpect.configure({timeout:20000});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1620,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let size=1000,responseAt=0;
try {
  await page.goto(appUrl+'/login?next=%2Fknowledge');
  await page.getByLabel('이메일').fill(users.author.email);
  await page.locator('input[type="password"]').fill(users.author.password);
  await page.getByRole('button',{name:'로그인',exact:true}).click();
  await expect(page.getByRole('heading',{name:'회사 문서',exact:true})).toBeVisible();
  await page.route('**/api/v1/knowledge/graph?format=compact',async route=>{
    const response=await route.fetch(),graph=await response.json();assert.equal(graph.format,'indexed-v1');
    const selected=graph.nodes.map((node,index)=>({node,index})).filter(({node})=>node[1].startsWith('QA scale ')).slice(0,size);
    assert.equal(selected.length,size,'run the 5000-document local fixture first');
    const index=new Map(selected.map((n,i)=>[n.index,i]));
    const body={...graph,nodes:selected.map(n=>n.node),edges:graph.edges.filter(([a,b])=>index.has(a)&&index.has(b)).map(([a,b])=>[index.get(a),index.get(b)]),broken:[]};
    responseAt=performance.now();await route.fulfill({response,json:body});
  });
  await page.goto(appUrl+'/knowledge/graph');
  const canvas=page.locator('.kw-graph-canvas');
  await expect(canvas).toHaveAttribute('data-node-count','1000');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const firstDrawMs=Math.round(performance.now()-responseAt);
  // RAF observation is an automated headless proxy, not a manual Chrome performance trace.
  await page.evaluate(()=>{window.__qaFrames=[];window.__qaDone=false;const start=performance.now();function tick(now){window.__qaFrames.push(now);if(now-start<3000)requestAnimationFrame(tick);else window.__qaDone=true;}requestAnimationFrame(tick);});
  const box=await canvas.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  for(let i=0;i<90;i++)await page.mouse.move(box.x+box.width/2+Math.sin(i/10)*100,box.y+box.height/2+Math.cos(i/10)*80);
  await page.mouse.up();await page.waitForFunction(()=>window.__qaDone);
  const frames=await page.evaluate(()=>window.__qaFrames),fps=Math.round((frames.length-1)*1000/(frames.at(-1)-frames[0]));
  await page.getByRole('button',{name:'지도 확대',exact:true}).click();
  assert.ok(Number(await canvas.getAttribute('data-zoom'))>1);
  console.log(JSON.stringify({nodes:1000,firstDrawMs,headlessRafFps:fps}));
  size=1500;await page.getByRole('button',{name:'새로고침',exact:true}).click();
  await expect(page.getByText('문서가 많아 고른 문서 주변만 보여 줍니다.',{exact:true})).toBeVisible();
  assert.ok(Number(await canvas.getAttribute('data-node-count'))<=1000);
  await page.getByRole('button',{name:'전체 보기',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-node-count','1500');
  size=2001;await page.getByRole('button',{name:'새로고침',exact:true}).click();
  await expect(page.getByRole('button',{name:'전체 보기',exact:true})).toBeDisabled();
  await expect(page.getByText(/2,000개가 넘어 전체 지도는 다음 단계/)).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('PASS graph browser: 1000-node canvas/pan/zoom; 1500-node opt-in full view; 2001-node guard');
} finally {await browser.close();}
