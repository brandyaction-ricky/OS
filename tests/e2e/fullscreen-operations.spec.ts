import {expect,test} from "@playwright/test";
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem("brandy-os-menu-guide-final","seen"));});
test("meeting and leave tabs retain original addresses after refresh",async({page})=>{
  await page.goto("/organization/meetings");
  await page.getByRole("button",{name:"모든 결정",exact:true}).click();
  await expect(page).toHaveURL(/\/home\/decisions\?tab=decisions/);
  await page.reload();
  await expect(page.getByRole("navigation",{name:"결정 출처"})).toBeVisible();
  await page.getByRole("navigation",{name:"회의·결정 보기"}).getByRole("button",{name:"회의",exact:true}).click();
  await expect(page).toHaveURL(/\/organization\/meetings/);
  await page.goto("/organization/schedule");
  await page.getByRole("navigation",{name:"업무 화면 탭"}).getByRole("link",{name:"연차·휴가"}).click();
  await expect(page).toHaveURL(/\/organization\/leave$/);
  await page.reload();
  await expect(page.getByRole("navigation",{name:"업무 화면 탭"}).getByRole("link",{name:"연차·휴가"})).toHaveAttribute("aria-current","page");
});
test("connection list uses actual evidence and retains read-only demo restrictions",async({page})=>{
  await page.goto("/settings/connections");
  await page.getByRole("table",{name:"연결 확인 근거"}).getByRole("button",{name:"지식 검색",exact:true}).click();
  const detail=page.getByRole("complementary",{name:"선택한 연결 상세"});
  await expect(detail.getByRole("heading",{name:"지식 검색"})).toBeVisible();
  await expect(detail.getByRole("button",{name:"연결 테스트",exact:true})).toBeDisabled();
  await page.getByRole("navigation",{name:"연결 상태 필터"}).getByRole("button",{name:"오류",exact:true}).click();
  await expect(page.getByText("이 상태에 해당하는 연결이 없습니다.",{exact:true})).toBeVisible();
});
test("project summary shows status labels beside counts",async({page})=>{
  await page.goto("/knowledge/development");
  const overview=page.getByRole("region",{name:"프로젝트 전체 현황"});
  const received=overview.getByRole("button",{name:"접수 0건 보기",exact:true}).first();
  await expect(received.getByText("접수",{exact:true})).toBeVisible();
  await received.click();
  await expect(page.getByRole("button",{name:/^접수\s*0$/})).toHaveClass(/active/);
  await expect(page.locator(".dev-inbox")).toHaveCount(0);
});
for(const width of [1280,390])for(const theme of ["light","dark"])test(`operations screens ${width}px ${theme}`,async({page},testInfo)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:840});
  await page.addInitScript(value=>localStorage.setItem("brandy-os-theme",value),theme);
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  for(const [name,path] of [["home","/home"],["meetings","/organization/meetings"],["decisions","/home/decisions"],["tasks","/organization/tasks"],["schedule","/organization/schedule"],["leave","/organization/leave"],["members","/organization/members"],["requests","/knowledge/development"],["updates","/knowledge/development?tab=updates"],["ai","/organization/agents"],["connections","/settings/connections"],["monitoring","/settings/monitoring"],["channels","/settings/channels"],["access","/settings/access"],["audit","/settings/audit"],["company","/settings/company"],["account","/settings/account"]]){
    await page.goto(path);
    await expect(page.getByRole("heading",{level:1}).first()).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`${name}-${width}-${theme}.png`),mask:[page.locator(".profile-trigger")]});
  }
  expect(errors).toEqual([]);
});
