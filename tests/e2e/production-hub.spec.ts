import {expect,test} from "@playwright/test";
import {LEGACY_WORKSPACE_TABS} from "../../lib/workspace-tabs";
test("merged workspaces keep legacy links, one heading and stable tab URLs",async({page})=>{
 for(const [old,[target,tab]]of Object.entries(LEGACY_WORKSPACE_TABS)){
  await page.goto(`${old}?record=fixture`);await expect(page).toHaveURL(`${new URL(target,process.env.PLAYWRIGHT_BASE_URL).href}?record=fixture&tab=${tab}`);await expect(page.getByRole("heading",{level:1})).toHaveCount(1);await expect(page.locator(".hub-tabs a[aria-current=page]")).toHaveAttribute("href",`${target}?tab=${tab}`);
  await page.reload();await expect(page.locator(".hub-tabs a[aria-current=page]")).toHaveAttribute("href",`${target}?tab=${tab}`);
 }
});
test("one content card retains its source across all stages, reload and browser history",async({page})=>{
 await page.goto("/content/production");await page.getByRole("link",{name:/예시 · 새 콘텐츠 기획/}).click();
 for(const [step,label] of [["planning","기획"],["script","원고"],["package","제목·썸네일"],["short","숏폼"],["publish","발행"]]){
  await page.getByRole("navigation",{name:"콘텐츠 작업 단계"}).getByRole("link",{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp(`sourceId=demo-production-plan&step=${step}`));await expect(page.locator(".production-detail-heading").getByRole("heading",{name:"예시 · 새 콘텐츠 기획",exact:true})).toBeVisible();await expect(page.getByRole("heading",{level:1})).toHaveCount(1);await page.reload();await expect(page.locator(".production-detail-heading").getByRole("heading",{name:"예시 · 새 콘텐츠 기획",exact:true})).toBeVisible();
 }
 await page.goBack();await expect(page).toHaveURL(/step=short/);await page.goForward();await expect(page).toHaveURL(/step=publish/);
 await page.goto("/content/packages?sourceId=missing&tab=saved");await expect(page).toHaveURL(/sourceId=missing&tab=saved&step=package/);await expect(page.getByText("콘텐츠를 찾을 수 없습니다",{exact:true})).toBeVisible();await expect(page.locator(".production-detail")).toHaveCount(0);
});
test("topic and finance tabs can be shared and legacy script tools stay available",async({page})=>{
 await page.goto("/content/topics?tab=discovery");await expect(page.getByRole("button",{name:/터진 영상 발굴/})).toHaveClass(/active/);await page.reload();await expect(page.getByRole("button",{name:/터진 영상 발굴/})).toHaveClass(/active/);
 await page.goto("/organization/finance?tab=subscription");await expect(page.locator(".finance-tabs button.active")).toContainText("구독");await page.reload();await expect(page.locator(".finance-tabs button.active")).toContainText("구독");
 await page.goto("/settings/connections");await expect(page.getByRole("region",{name:"YouTube 채널 연결 관리"})).toBeVisible();await expect(page.getByRole("button",{name:"Google 채널 연결",exact:true})).toBeDisabled();
 await page.goto("/content/scripts");await expect(page).toHaveURL(/view=tools/);await expect(page.getByRole("button",{name:"새 원고 작성",exact:true}).first()).toBeVisible();
});
for(const theme of ["dark","light"])for(const width of [1440,390])test(`production and merged tabs at ${width}px ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:960});await page.addInitScript(value=>localStorage.setItem("brandy-os-theme",value),theme);
 const capture=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/private/tmp/uiux-${name}-${theme}-${width}.png`,mask:[page.locator(".profile-trigger")],maskColor:await page.locator(".unified-sidebar").evaluate(e=>getComputedStyle(e).backgroundColor)});};
 await page.goto("/content/production");await expect(page.locator(".production-card")).toHaveCount(2);await capture("production");
 await page.getByRole("link",{name:/예시 · 새 콘텐츠 기획/}).click();await page.getByRole("navigation",{name:"콘텐츠 작업 단계"}).getByRole("link",{name:"제목·썸네일",exact:true}).click();await capture("production-detail");
 await page.goto("/performance/overview?tab=goals");await capture("company-tabs");
});
