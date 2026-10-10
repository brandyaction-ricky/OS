import { expect,test } from "@playwright/test";

const pages=[
  ["dashboard","자동화 현황"],["topics","주제 기획"],["cardnews","카드뉴스"],
  ["shorts","쇼츠"],["threads","쓰레드"],["review","최종 확인"],
  ["calendar","발행"],["performance","반응·성과"],["requests","AI 작업함"],
  ["settings","자동화 설정"],
] as const;

test("all ten automation screens render without horizontal overflow in desktop and mobile demo",async({page})=>{
  test.setTimeout(120_000);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    for(const [path,title] of pages){
      await page.goto(`/automation/${path}`);
      await expect(page.locator(".ca-v07 h1")).toContainText(title);
      await expect(page.locator(".ca-v07-loading")).toHaveCount(0);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
      expect(overflow,`${path} at ${width}px`).toBe(false);
    }
  }
});

test("worker demo exposes rules but no shell, navigation links or registration action",async({page})=>{
  await page.goto("/automation/worker?via=sched");
  await expect(page.getByRole("heading",{name:"AI 작업 화면"})).toBeVisible();
  await expect(page.locator(".ca-worker-rules li")).toHaveCount(6);
  await expect(page.locator(".app-sidebar,.app-topbar,.ca-worker a,.ca-worker button")).toHaveCount(0);
  await expect(page.getByText("등록되지 않은 브라우저입니다.")).toBeVisible();
});
