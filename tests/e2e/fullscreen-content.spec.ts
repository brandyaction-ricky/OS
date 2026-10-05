import {expect,test} from "@playwright/test";
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem("brandy-os-menu-guide-final","seen"));});
test("content stages retain existing controls and publishing links retain routes",async({page})=>{
  await page.goto("/content/topics");
  const stages=page.getByRole("navigation",{name:"주제 탐색 단계"});
  await expect(stages.getByRole("button")).toHaveCount(4);
  await stages.getByRole("button").last().click();
  await expect(stages.getByRole("button").last()).toHaveAttribute("aria-pressed","true");
  await page.goto("/content/packages");
  await expect(page.getByRole("navigation",{name:"제목 썸네일 작업 단계"}).getByRole("button")).toHaveCount(4);
  await page.goto("/content/scripts");
  await page.getByRole("navigation",{name:"원고 공정 산출물"}).getByRole("button",{name:/^초안/}).click();
  await expect(page.getByRole("navigation",{name:"원고 공정 산출물"}).getByRole("button",{name:/^초안/})).toHaveAttribute("aria-pressed","true");
  await page.goto("/content/publishing");
  await expect(page.getByRole("heading",{name:"발행·업로드",level:1})).toBeVisible();
  await expect(page.locator(".publishing-workspace-tabs")).toHaveCount(0);
});
test("comments show real scoped counts and require selection before composing",async({page})=>{
  await page.goto("/content/comments");
  await expect(page.getByRole("heading",{name:"댓글을 선택해 주세요"})).toBeVisible();
  await page.getByRole("button",{name:"모의 댓글 불러오기 · 외부 저장 없음"}).click();
  await expect(page.getByRole("navigation",{name:"댓글 보기"}).getByRole("button",{name:/답할 것/})).toContainText("3");
  await page.getByRole("button",{name:"답글 · 처리",exact:true}).first().click();
  await expect(page.locator('.comment-row[data-selected="true"]')).toHaveCount(1);
  await expect(page.getByRole("button",{name:"모의 답글 보내기"})).toBeDisabled();
  await page.getByRole("navigation",{name:"댓글 보기"}).getByRole("button",{name:/답함/}).click();
  await expect(page.getByRole("heading",{name:"댓글을 선택해 주세요"})).toBeVisible();
});
for(const width of [1280,390]) test(`content bodies stay within ${width}px viewport`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:840});
  for(const path of ["topics","scripts","packages","shorts","publishing","automation","calendar","youtube","comments","performance"]){
    await page.goto(`/content/${path}`);
    await expect(page.getByRole("heading",{level:1}).first()).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`${path}-${width}.png`),mask:[page.locator(".profile-trigger")]});
  }
});
