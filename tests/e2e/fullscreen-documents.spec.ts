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
  await page.getByRole("button",{name:"Skill 추가",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"새 Skill"})).toContainText("연결 해제");
  await page.getByRole("button",{name:"Skill 닫기"}).click();
  await page.getByRole("link",{name:"정본 등록 시작"}).click();
  await expect(page).toHaveURL(/new=1/);
  await expect(page.getByRole("textbox",{name:"새 페이지 제목",exact:true})).toBeVisible();
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
