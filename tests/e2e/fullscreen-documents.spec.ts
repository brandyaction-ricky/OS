import {expect,test} from "@playwright/test";
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem("brandy-os-menu-guide-final","seen");localStorage.setItem("brandy-knowledge-focus","false");});});
test("canonical list reads existing documents and keeps promotion in review",async({page})=>{
  await page.goto("/knowledge?tab=canon");
  await expect(page).toHaveURL(/\/knowledge\/canon$/);
  await expect(page.getByRole("heading",{name:"회사 정본",level:1})).toBeVisible();
  await expect(page.getByRole("link",{name:"문서 작성 기준",exact:true})).toBeVisible();
  await page.getByLabel("정본 검색").fill("일치하지않는검색어-qa");
  await page.getByRole("button",{name:"검색",exact:true}).click();
  await expect(page.getByText("조건에 맞는 정본이 없습니다",{exact:true})).toBeVisible();
  await page.getByLabel("정본 검색").fill("");
  await page.getByLabel("정본 검색").press("Enter");
  await page.getByRole("link",{name:"문서 작성 기준",exact:true}).click();
  await expect(page.locator(".document-reader")).toContainText("목적과 근거");
  await expect(page.getByRole("textbox",{name:"editable markdown"})).toHaveCount(0);
  await page.getByRole("link",{name:"변경 제안",exact:true}).click();
  await expect(page).toHaveURL(/\/propose$/);
  await expect(page.getByRole("textbox",{name:"editable markdown"})).toContainText("목적과 근거");
  await expect(page.getByText("작성자·문서 소유자는 이 제안을 승인할 수 없습니다.",{exact:true})).toBeVisible();
});
test("canonical folders and result count remain inside their columns",async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.goto("/knowledge/canon");
  const sidebar=page.locator(".kw-categories");
  const table=page.locator(".kw-table-wrap");
  await expect(sidebar).toBeVisible();
  await expect.poll(async()=>{
    const [left,right]=await Promise.all([sidebar.boundingBox(),table.boundingBox()]);
    return Boolean(left&&right&&left.x+left.width<=right.x);
  }).toBe(true);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test("a canonical proposal deep link opens its comparison without granting approval",async({page})=>{
  await page.goto("/knowledge/canon/example-canonical/propose");
  await page.getByRole("textbox",{name:"editable markdown"}).fill("QA 연결된 제안");
  await page.getByRole("textbox",{name:/변경 이유/}).fill("검토 링크 확인");
  await page.getByRole("combobox",{name:"승인자",exact:true}).selectOption("example-approver");
  await page.getByRole("button",{name:"변경 제안 보내기"}).click();
  await expect(page).toHaveURL(/tab=sent/);
  const id=new URL(page.url()).searchParams.get("id");
  expect(id).toBeTruthy();
  await page.goto("/knowledge/review?proposal="+id);
  await expect(page.locator(".kw-diff")).toContainText("QA 연결된 제안");
  await expect(page.getByRole("button",{name:"변경 승인",exact:true})).toBeDisabled();
});
test("canonical workflow APIs fail closed without a session",async({request})=>{
  for(const path of ["/api/v1/knowledge/canonical","/api/v1/knowledge/canonical/worker"]){
    const result=await request.post(path,{data:{action:"extract"}});
    expect(result.status()).toBe(401);
    expect((await result.json()).error.code).toBe("AUTH_REQUIRED");
  }
});
for(const width of [1280,390])test(`canonical workflow is bounded and safe in demo at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:840});
  const external:string[]=[];page.on("request",req=>{if(/knowledge\/canonical|api.anthropic.com/.test(req.url()))external.push(req.url());});
  await page.goto("/knowledge/canon/example-canonical");
  await page.locator("summary").filter({hasText:"원문 연결 · 규칙 추출"}).click();
  const workflow=page.getByRole("region",{name:"정본 동기화와 규칙 추출"});
  await expect.poll(async()=>((await workflow.locator(":scope > .quiet-state").boundingBox())?.height??Infinity)).toBeLessThanOrEqual(90);
  await workflow.getByText("외부 원문 연결",{exact:true}).click();
  await workflow.getByText("파일로 변경 제안",{exact:true}).click();
  await expect(workflow.getByLabel("HTTPS 원문 주소")).toBeDisabled();
  await expect(workflow.getByLabel("원문 파일")).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`canonical-workflow-${width}.png`),fullPage:true,mask:[page.locator(".profile-trigger")]});
  expect(external).toEqual([]);
});
for(const width of [1280,390]) test(`document screen layouts at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:840});
  for(const [name,path] of [["documents","/knowledge"],["canon","/knowledge?tab=canon"],["links","/knowledge/graph"],["search","/knowledge/search"],["review","/knowledge/review"]]){
    await page.goto(path);
    await expect(page.getByRole("heading",{level:1}).first()).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`${name}-${width}.png`),mask:[page.locator(".profile-trigger")]});
  }
});
