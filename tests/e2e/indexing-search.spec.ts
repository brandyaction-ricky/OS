import {expect,test} from "@playwright/test";

test("search progress and retry APIs reject unauthenticated callers and agent keys",async({request})=>{
 for(const route of ["/api/v1/search/progress","/api/v1/indexing"]){
  expect((await request.get(route)).status()).toBe(401);
  expect((await request.get(route,{headers:{Authorization:"Bearer bos_pat_synthetic"}})).status()).toBe(403);
 }
 expect((await request.post("/api/v1/indexing",{data:{action:"retry_failed",limit:1}})).status()).toBe(401);
});
test("demo search keeps applied criteria visible and empty results distinct from loading",async({page})=>{
 await page.goto("/knowledge/search?q=unlikely-fixture-empty");
 await expect(page.locator(".index-progress")).toContainText("데모");
 await expect(page.getByRole("heading",{name:"관련 지식을 찾지 못했습니다"})).toBeVisible();
 await page.getByRole("button",{name:"정확한 단어",exact:true}).click();
 await expect(page.getByText(/조건 변경됨/)).toBeVisible();
 await page.getByRole("button",{name:"지식 검색",exact:true}).click();
 await expect(page.getByText(/조건 변경됨/)).toHaveCount(0);
 await expect(page.locator(".results-summary")).toContainText("정확한 단어");
});
for(const theme of ["dark","light"])for(const width of [1440,390])test(`search and indexing at ${width}px ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:960});await page.addInitScript(value=>localStorage.setItem("brandy-os-theme",value),theme);
 const capture=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/private/tmp/uiux-${name}-${theme}-${width}.png`,mask:[page.locator(".profile-trigger")],maskColor:"#777777"});};
 await page.goto("/knowledge/search");await expect(page.locator(".index-progress")).toContainText("데모");expect(await page.getByRole("button",{name:"균형 검색",exact:true}).evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(40);await capture("search-index");
 await page.goto("/settings/monitoring");await expect(page.getByRole("heading",{level:1,name:"작동 상태",exact:true})).toBeVisible();if(width===390)await page.getByRole("heading",{name:"지식 검색 준비 작업",exact:true}).scrollIntoViewIfNeeded();await capture("index-queue");
});
