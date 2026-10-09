import {expect,test} from "@playwright/test";

test("search progress and retry APIs reject unauthenticated callers and agent keys",async({request})=>{
 for(const route of ["/api/v1/search/progress","/api/v1/indexing"]){
  expect((await request.get(route)).status()).toBe(401);
  expect((await request.get(route,{headers:{Authorization:"Bearer bos_pat_synthetic"}})).status()).toBe(403);
 }
 expect((await request.post("/api/v1/indexing",{data:{action:"retry_failed",limit:1}})).status()).toBe(401);
});
test("demo search keeps applied space and query visible and empty results distinct from loading",async({page})=>{
 await page.goto("/knowledge/search?q=unlikely-fixture-empty");
 await expect(page.getByText("검색 결과가 없습니다. 검색 범위나 단어를 바꿔 보세요.",{exact:true})).toBeVisible();
 await page.getByRole("textbox",{name:"문서 검색어"}).fill("문서 작성");
 await page.getByRole("button",{name:"검색",exact:true}).click();
 await expect(page.getByRole("heading",{name:"제목 일치",exact:true})).toBeVisible();
 await expect(page.locator(".kw-search-result").getByRole("link",{name:"문서 작성 기준"})).toBeVisible();
 await page.getByRole("combobox",{name:"검색 공간"}).selectOption("team");
 await expect(page).toHaveURL(/space=team/);
 await expect(page.getByText("검색 결과가 없습니다. 검색 범위나 단어를 바꿔 보세요.",{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole("combobox",{name:"검색 공간"})).toHaveValue("team");
 await expect(page.getByRole("textbox",{name:"문서 검색어"})).toHaveValue("문서 작성");
});
for(const theme of ["dark","light"])for(const width of [1440,390])test(`search and indexing at ${width}px ${theme}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:960});await page.addInitScript(value=>localStorage.setItem("brandy-os-theme",value),theme);
 const capture=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath(`uiux-${name}-${theme}-${width}.png`),mask:[page.locator(".profile-trigger")],maskColor:"#777777"});};
 await page.goto("/knowledge/search");await expect(page.getByRole("textbox",{name:"문서 검색어"})).toBeVisible();await expect(page.getByRole("checkbox",{name:"내 노트 포함"})).not.toBeChecked();expect(await page.getByRole("button",{name:"검색",exact:true}).evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(40);await capture("search-index");
 await page.goto("/settings/monitoring");await expect(page.getByRole("heading",{level:1,name:"작동 상태",exact:true})).toBeVisible();if(width===390)await page.getByRole("heading",{name:"지식 검색 준비 작업",exact:true}).scrollIntoViewIfNeeded();await capture("index-queue");
});
