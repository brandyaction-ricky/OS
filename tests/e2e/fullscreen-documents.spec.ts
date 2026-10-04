import {expect,test} from "@playwright/test";
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem("brandy-os-menu-guide-final","seen");localStorage.setItem("brandy-knowledge-focus","false");});});
test("canonical tab reads existing documents and keeps promotion in review",async({page})=>{
  await page.goto("/knowledge");
  await page.getByRole("navigation",{name:"전체 문서 보기"}).getByRole("link",{name:"정본",exact:true}).click();
  await expect(page).toHaveURL(/tab=canon/);
  await expect(page.getByRole("navigation",{name:"전체 문서 보기"}).getByRole("link",{name:"정본",exact:true})).toHaveAttribute("aria-current","page");
  await expect(page.locator(".canon-document").first()).toBeVisible();
  await expect(page.getByRole("region",{name:"정본 상세"}).getByRole("link",{name:"원문 열기 · 변경 제안"})).toBeVisible();
  await page.getByLabel("정본 찾기").fill("일치하지않는검색어-qa");
  await expect(page.getByText("조건에 맞는 정본이 없습니다.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"실행 규칙",exact:true}).click();
  await expect(page.getByText("연결할 정본을 먼저 선택해 주세요.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Skill 추가",exact:true})).toHaveCount(0);
  await page.getByLabel("정본 찾기").fill("");
  await page.getByRole("button",{name:"실행 규칙",exact:true}).click();
  const workflow=page.getByRole("region",{name:"정본 동기화와 규칙 추출"});
  await expect(workflow).toBeVisible();
  await expect(workflow.getByRole("button",{name:"규칙 추출 요청",exact:true})).toBeDisabled();
  await expect(workflow).toContainText("데모에서는 외부 원문·AI를 호출하거나 작업을 저장하지 않습니다.");
  await page.getByRole("button",{name:"Skill 추가",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"새 Skill"})).toContainText("연결 해제");
  await page.getByRole("button",{name:"Skill 닫기"}).click();
  await page.getByRole("link",{name:"정본 등록 시작"}).click();
  await expect(page).toHaveURL(/new=1/);
  await expect(page.getByRole("textbox",{name:"새 페이지 제목",exact:true})).toBeVisible();
});
test("a canonical proposal deep link opens the existing approval tab",async({page})=>{
  await page.goto("/knowledge/review?proposal=00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("tab",{name:"정본 변경 제안",exact:true})).toHaveAttribute("aria-selected","true");
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
  await page.goto("/knowledge?tab=canon");
  await page.getByRole("button",{name:"실행 규칙",exact:true}).click();
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
