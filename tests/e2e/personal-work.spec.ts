import {expect,test} from "@playwright/test";
test("personal home defaults to received work and preserves tab/view URLs", async({page})=>{
 await page.goto("/home"); await expect(page.getByRole("heading",{name:"내 할 일",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"배정된 일이 없습니다"})).toBeVisible();
 await page.getByRole("button",{name:/요청한 일/}).click();await page.reload();
 await expect(page.getByRole("heading",{name:"남긴 요청이 없습니다"})).toBeVisible();
 await expect(page.getByRole("region",{name:"오늘 콘텐츠 운영"})).toBeVisible();
 await expect(page.locator(".revenue-band")).toHaveCount(0);
 await expect(page.getByRole("heading",{level:1})).toHaveCount(1);
});
test("request drawer keeps the original screen and supports unsaved input and legacy URLs",async({page})=>{
 await page.goto("/content/comments");await page.getByRole("button",{name:"수정 요청 남기기"}).click();
 const drawer=page.getByRole("dialog",{name:"수정 요청",exact:true});await expect(drawer).toBeVisible();
 await expect(drawer.getByLabel("화면 주소")).toHaveValue(/\/content\/comments$/);await expect(drawer.getByLabel("프로젝트")).toHaveValue("demo-os");
 await drawer.getByLabel("제목",{exact:true}).fill("화면 확인 요청");await page.keyboard.press("Escape");
 await expect(drawer.getByRole("button",{name:"계속 작성"})).toBeVisible();await drawer.getByRole("button",{name:"계속 작성"}).click();
 await expect(drawer.getByLabel("제목",{exact:true})).toHaveValue("화면 확인 요청");
 await drawer.getByLabel("자료 첨부").setInputFiles({name:"fixture.txt",mimeType:"text/plain",buffer:Buffer.from("test")});
 await drawer.getByLabel("현재 문제").fill("검증용 입력");await drawer.getByRole("button",{name:"수정 요청 등록"}).click();
 await expect(drawer.getByText("데모에서는 실제 요청을 저장하지 않습니다.")).toBeVisible();
 await drawer.getByRole("button",{name:"닫기",exact:true}).click();await expect(page).toHaveURL(/\/content\/comments$/);
 await page.goto("/knowledge/development?new=request&page=%2Fcontent%2Fcomments");
 await expect(drawer.getByLabel("화면 주소")).toHaveValue(/\/content\/comments$/);
});
test("update history is directly addressable and notification APIs require login",async({page,request})=>{
 await page.goto("/knowledge/development?tab=updates");await expect(page.getByRole("heading",{level:1})).toHaveText("업데이트 내역");
 await expect(page.getByRole("heading",{name:"변경과 배포의 기록"})).toBeVisible();
 for(const route of ["my-work","notifications"])expect((await request.get(`/api/v1/${route}`)).status()).toBe(401);
});
for(const theme of ["dark","light"])for(const width of [1440,390])test(`personal work and request drawer at ${width}px ${theme}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:960});await page.addInitScript(value=>localStorage.setItem("brandy-os-theme",value),theme);
 await page.goto("/home");await expect(page.getByRole("heading",{name:"배정된 일이 없습니다"})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath(`uiux-personal-${theme}-${width}.png`),mask:[page.locator(".profile-trigger")],maskColor:await page.locator(".unified-sidebar").evaluate(element=>getComputedStyle(element).backgroundColor)});
 if(width===390)await page.getByRole("button",{name:"메뉴 열기"}).click();
 await page.getByRole("button",{name:"수정 요청 남기기"}).click();
 const drawer=page.getByRole("dialog",{name:"수정 요청",exact:true});await expect(drawer.getByLabel("프로젝트")).toHaveValue("demo-os");
 await page.screenshot({path:testInfo.outputPath(`uiux-request-${theme}-${width}.png`),mask:[page.locator(".profile-trigger")],maskColor:await page.locator(".unified-sidebar").evaluate(element=>getComputedStyle(element).backgroundColor)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press("Escape");await expect(drawer).toBeHidden();
});
