import {expect,test} from "@playwright/test";
async function openMeeting(page:import("@playwright/test").Page){await page.goto("/organization/meetings");await page.getByRole("button",{name:"회의 기록",exact:true}).first().click();return page.locator(".meeting-drawer");}
test("meeting review requires assignee and due date, saves reviewed actions, and reopens without duplicating them",async({page})=>{
 const drawer=await openMeeting(page);await drawer.getByLabel("회의명",{exact:true}).fill("검증용 회의");
 await drawer.getByLabel("직접 추가할 업무 · 한 줄에 하나").fill("자료 확인");await expect(drawer.getByRole("button",{name:"검수 확정·회의 저장"})).toBeDisabled();
 await drawer.getByRole("button",{name:"직접 입력을 검수에 추가"}).click();
 await expect(drawer.getByRole("button",{name:"검수 확정·회의 저장"})).toBeDisabled();
 await drawer.getByLabel("항목 1 담당자").selectOption({label:"데모 담당자"});await drawer.getByLabel("항목 1 기한").fill("2026-10-05");
 await drawer.getByLabel("항목 1 완료 기준").fill("확인 결과를 문서에 기록");
 await drawer.getByRole("button",{name:"검수 확정·회의 저장"}).click();await expect(drawer).toBeHidden();
 await expect(page.locator(".meeting-card")).toContainText("후속 업무 1");await page.locator(".meeting-card").click();
 await expect(drawer.getByLabel("항목 1 담당자")).toHaveValue("demo-ricky");await drawer.getByRole("button",{name:"검수 확정·회의 저장"}).click();await expect(page.locator(".meeting-card")).toHaveCount(1);await expect(page.locator(".meeting-card")).toContainText("후속 업무 1");
});
test("meeting phases navigate and decisions retain old deep links",async({page})=>{
 const drawer=await openMeeting(page);await drawer.getByRole("button",{name:"3. 검수·확정"}).click();await expect(drawer.getByLabel("회의 요약",{exact:true})).toBeInViewport();
 await page.goto("/home/decisions?record=fixture");await expect(page).toHaveURL(/\/home\/decisions\?record=fixture/);await expect(page.getByRole("heading",{level:1})).toHaveText("회의·결정");await expect(page.getByRole("navigation",{name:"결정 출처"})).toBeVisible();
});
test("unassigned work is kept off the board and bulk assignment moves it to my work",async({page})=>{
 await page.goto("/organization/tasks");await expect(page.getByRole("button",{name:"내 업무",exact:true})).toHaveAttribute("aria-pressed","true");
 await page.getByRole("button",{name:"업무 추가",exact:true}).click();const drawer=page.locator(".record-drawer");
 await drawer.getByLabel("업무명",{exact:true}).fill("검증용 미지정 업무");await drawer.getByLabel("상세 설명",{exact:true}).fill("검증용 설명");await drawer.getByLabel("완료 기준",{exact:true}).fill("결과 확인");
 await drawer.getByRole("button",{name:/저장/}).click();await expect(drawer).toBeHidden();await expect(page.locator(".task-board")).not.toContainText("검증용 미지정 업무");
 await page.getByRole("button",{name:/분류 대기 1/}).click();await page.getByRole("checkbox",{name:"검증용 미지정 업무 선택"}).check();
 await expect(page.getByRole("button",{name:"1개 지정",exact:true})).toBeDisabled();await page.getByLabel("일괄 담당자").selectOption({label:"데모 담당자"});await page.getByLabel("일괄 기한").fill("2026-10-05");await page.getByRole("button",{name:"1개 지정",exact:true}).click();
 await expect(page.getByText("1개 업무를 지정했습니다.",{exact:true})).toBeVisible();await page.getByRole("button",{name:"내 업무",exact:true}).click();await expect(page.locator(".task-board")).toContainText("검증용 미지정 업무");
});
for(const theme of ["dark","light"])for(const width of [1440,390])test(`review and triage at ${width}px ${theme}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:960});await page.addInitScript(value=>localStorage.setItem("brandy-os-theme",value),theme);
 const drawer=await openMeeting(page);await drawer.getByRole("button",{name:"항목 직접 추가"}).click();await drawer.getByLabel("항목 1 분류").selectOption("task");await drawer.getByLabel("항목 1 내용").fill("검증용 후속 업무");await drawer.getByLabel("항목 1 담당자").selectOption({label:"데모 담당자"});await drawer.getByLabel("항목 1 기한").fill("2026-10-05");await drawer.getByLabel("항목 1 내용").scrollIntoViewIfNeeded();
 await page.screenshot({path:testInfo.outputPath(`uiux-meeting-${theme}-${width}.png`),mask:[page.locator(".profile-trigger")],maskColor:await page.locator(".unified-sidebar").evaluate(element=>getComputedStyle(element).backgroundColor)});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto("/organization/tasks");await page.getByRole("button",{name:"업무 추가",exact:true}).click();await page.locator(".record-drawer").getByLabel("업무명",{exact:true}).fill("검증용 분류 대기 업무");await page.locator(".record-drawer").getByLabel("상세 설명",{exact:true}).fill("검증용 설명");await page.locator(".record-drawer").getByRole("button",{name:/저장/}).click();await page.getByRole("button",{name:/분류 대기 1/}).click();await page.getByRole("checkbox",{name:"검증용 분류 대기 업무 선택"}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`uiux-triage-${theme}-${width}.png`),mask:[page.locator(".profile-trigger")],maskColor:await page.locator(".unified-sidebar").evaluate(element=>getComputedStyle(element).backgroundColor)});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
