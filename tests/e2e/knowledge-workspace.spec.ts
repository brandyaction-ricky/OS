import {expect,test} from "@playwright/test";
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem("brandy-os-menu-guide-final","seen"));
});
const paths=[
 ["/knowledge","회사 문서"],["/knowledge/notes","내 노트"],["/knowledge/meetings","회의록"],
 ["/knowledge/decisions","결정 모음"],["/knowledge/docs","팀 문서"],["/knowledge/canon","회사 정본"],
 ["/knowledge/graph","연결"],["/knowledge/review","검토함"],["/knowledge/templates","템플릿"],
 ["/knowledge/trash","휴지통"],["/knowledge/search","문서 찾기"],["/knowledge/activity","문서 활동 기록"],
];
for(const width of [1440,1024,390]) test(`company workspace routes and horizontal bounds at ${width}px`,async({page},info)=>{
 test.setTimeout(120000);
 await page.setViewportSize({width,height:900});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 for(const[path,title]of paths){await page.goto(path);await expect(page.getByRole("heading",{name:title,level:1,exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.getByText(/Application error/)).toHaveCount(0);
  await expect(page.locator(".kw-root")).not.toContainText(/undefined|NaN|Infinity|\[object/);
  if(path==="/knowledge"||path==="/knowledge/graph"){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`${path.endsWith("graph")?"graph":"home"}-${width}.png`)});}
 }
 await page.screenshot({path:info.outputPath(`workspace-${width}.png`),fullPage:true});
 expect(errors).toEqual([]);
});
test("mobile document tree is visible on demand and editing remains within viewport",async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 const editor=await createNote(page,"QA 모바일 문서");await editor.fill("모바일 본문");
 await page.getByRole("button",{name:"저장",exact:true}).click();
 const toggle=page.getByRole("button",{name:/파일 트리/});
 if(await toggle.getAttribute("aria-pressed")!=="true")await toggle.click();
 await expect(page.getByRole("complementary",{name:"문서 파일 트리"})).toBeVisible();
 await toggle.click();await expect(page.getByRole("complementary",{name:"문서 파일 트리"})).toHaveCount(0);
 await expect(editor).toContainText("모바일 본문");
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath("mobile-editor.png"),fullPage:true});
});
test("large document database paginates without dropping search or view filters",async({page})=>{
 await createNote(page,"QA 목록 원본");
 await page.evaluate(()=>{
   const key=Object.keys(localStorage).find(key=>key.startsWith("brandyos:knowledge:v1:"))!;
   const state=JSON.parse(localStorage.getItem(key)!);
   const original=state.documents.find((doc:{title:string})=>doc.title==="QA 목록 원본");
   state.documents=Array.from({length:121},(_,i)=>({...original,id:`qa-row-${i}`,title:`QA 페이지 ${String(i).padStart(3,"0")}`}));
   localStorage.setItem(key,JSON.stringify(state));
 });
 await page.goto("/knowledge/notes?tab=all&q=QA+페이지&sort=title");
 await expect(page.locator(".kw-table tbody tr")).toHaveCount(50);
 const pages=page.getByRole("navigation",{name:"문서 목록 페이지"});
 await pages.getByRole("button",{name:"다음"}).click();
 await expect(page.locator(".kw-table tbody tr").first()).toContainText("QA 페이지 050");
 await pages.getByRole("button",{name:"다음"}).click();
 await expect(page.locator(".kw-table tbody tr")).toHaveCount(21);
 await page.getByRole("button",{name:"갤러리 보기"}).click();
 await expect(page.locator(".kw-gallery article")).toHaveCount(50);
 await expect(page).toHaveURL(/q=QA/);
});
async function createNote(page:import("@playwright/test").Page,title:string){
 await page.goto("/knowledge");
 await page.getByRole("button",{name:"새 문서",exact:true}).click();
 await page.getByRole("radio",{name:"내 노트 나만 봅니다. 메모·초안"}).check();
 await page.getByRole("textbox",{name:"제목",exact:true}).fill(title);
 await page.getByRole("button",{name:"만들기",exact:true}).click();
 await expect(page.getByRole("textbox",{name:"문서 제목"})).toHaveValue(title);
 return page.getByRole("textbox",{name:"editable markdown",exact:true});
}
test("create, draft, save, reopen, link insertion and version restore are persistent",async({page})=>{
 const editor=await createNote(page,"QA 저장 노트");
 await editor.fill("첫 번째 본문");
 await page.getByRole("button",{name:"저장",exact:true}).click();
 await expect(page.locator(".kw-properties")).toContainText("버전 2");
 await editor.fill("두 번째 본문");
 await expect(page.getByRole("status").filter({hasText:"임시 저장됨"})).toBeVisible({timeout:5000});
 await page.getByRole("button",{name:"저장",exact:true}).click();
 await expect(page.locator(".kw-properties")).toContainText("버전 3");
 await page.reload();await expect(editor).toContainText("두 번째 본문");
 await page.getByRole("button",{name:"버전 기록",exact:true}).click();
 const version=page.getByRole("dialog").getByRole("article").filter({has:page.getByRole("heading",{name:"v2 · QA 저장 노트"})});
 await version.getByRole("button",{name:"이 버전으로 복원"}).click();
 await expect(editor).toContainText("첫 번째 본문");
 await expect(page.locator(".kw-properties")).toContainText("버전 4");
 await page.getByRole("button",{name:"문서 연결",exact:true}).click();
 await page.getByRole("dialog").getByRole("button",{name:/문서 작성 기준/}).click();
 await expect(editor).toContainText("example-canonical");
 await page.getByRole("button",{name:"저장",exact:true}).click();
 await page.reload();await expect(editor).toContainText("example-canonical");
});
test("quick memo stores inbox then appends today's note once",async({page})=>{
 await page.goto("/knowledge");
 await page.getByRole("button",{name:/빠른 메모.*⌘J/}).click();
 await page.getByRole("textbox",{name:"메모",exact:true}).fill("QA 빠른 기록");
 await page.getByRole("button",{name:"메모 저장"}).click();
 await page.goto("/knowledge/notes?tab=inbox");
 await expect(page.getByText("QA 빠른 기록",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"오늘 노트에 붙이기"}).click();
 await page.goto("/knowledge/notes?tab=today");
 await expect(page.getByRole("textbox",{name:"editable markdown"})).toContainText("QA 빠른 기록");
 await page.reload();await expect(page.getByRole("textbox",{name:"editable markdown"})).toContainText("QA 빠른 기록");
});
test("export saves pending edits, includes versions and records the export request",async({page})=>{
 const editor=await createNote(page,"QA 내보내기");await editor.fill("저장 전 마지막 본문");
 await page.getByRole("button",{name:"문서 내보내기",exact:true}).click();
 await page.getByRole("combobox",{name:"범위",exact:true}).selectOption("doc_versions");
 const result=page.waitForEvent("download");await page.getByRole("button",{name:"내보내기",exact:true}).click();
 const download=await result;expect(download.suggestedFilename()).toBe("QA 내보내기.md");
 const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);
 const body=Buffer.concat(chunks).toString("utf8");expect(body).toContain("저장 전 마지막 본문");expect(body).toContain("# 버전 기록");
 await page.getByRole("button",{name:"문서 내보내기",exact:true}).click();
 await page.getByRole("combobox",{name:"형식",exact:true}).selectOption("pdf");
 const popup=page.waitForEvent("popup");await page.getByRole("button",{name:"내보내기",exact:true}).click();
 const print=await popup;await expect(print.getByRole("button",{name:"인쇄 · PDF로 저장"})).toBeVisible();
 await expect(print.locator("pre")).toContainText("저장 전 마지막 본문");await print.close();
  await page.goto("/knowledge/activity");await expect(page.locator(".kw-activity-row strong").filter({hasText:/^export$/}).first()).toBeVisible();
});
test("personal template saves body, creates selected-space document, survives reload",async({page})=>{
 await page.goto("/knowledge/templates");
 await page.getByRole("button",{name:"내 템플릿",exact:true}).click();
 await page.getByRole("button",{name:"템플릿 추가"}).click();
 await page.getByRole("textbox",{name:"이름",exact:true}).fill("QA 서식");
 await page.getByRole("textbox",{name:"내용 (Markdown)"}).fill("## 확인 항목");
 await page.getByRole("dialog").getByRole("button",{name:"저장",exact:true}).click();
 await page.reload();await page.getByRole("button",{name:"내 템플릿",exact:true}).click();
 const card=page.getByRole("article").filter({has:page.getByRole("heading",{name:"QA 서식",exact:true})});
 await card.getByRole("button",{name:"이 템플릿 사용"}).click();
 await page.getByRole("button",{name:"만들기",exact:true}).click();
 await expect(page.getByRole("textbox",{name:"editable markdown"})).toContainText("확인 항목");
 await expect(page.locator(".kw-editor-card")).toContainText("내 노트");
});
test("meeting start, review, confirmation and append-only correction",async({page})=>{
 await page.goto("/knowledge/meetings");
 await page.getByRole("button",{name:"새 회의",exact:true}).click();
 await page.getByRole("textbox",{name:"제목",exact:true}).fill("QA 회의");
 await page.getByRole("button",{name:"만들기",exact:true}).click();
 await expect(page.getByRole("heading",{name:"QA 회의",level:1})).toBeVisible();
 await page.getByRole("group",{name:"회의 메모",exact:true}).getByRole("textbox").fill("원문은 보존합니다.");
 await page.getByRole("button",{name:"저장",exact:true}).click();
 await page.getByRole("button",{name:"회의 시작",exact:true}).click();
 await page.getByRole("textbox",{name:"결정·할 일 내용"}).fill("검증된 결정을 채택합니다.");
 await page.getByRole("button",{name:"항목 추가"}).click();
 await page.getByRole("button",{name:"회의 종료 · 검수로"}).click();
 await expect(page.getByRole("button",{name:"검수 완료",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"채택",exact:true}).click();
 await page.getByRole("button",{name:"검수 완료",exact:true}).click();
 await expect(page.getByRole("button",{name:"정정 기록 추가"})).toBeVisible();
 await expect(page.getByRole("group",{name:"회의 메모",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"정정 기록 추가"}).click();
 await page.getByRole("textbox",{name:"정정 내용"}).fill("후속 확인 내용");
 await page.getByRole("textbox",{name:"정정 사유"}).fill("추가 근거");
 await page.getByRole("button",{name:"정정 저장"}).click();
 await expect(page.getByText("후속 확인 내용",{exact:true})).toBeVisible();
 await page.goto("/knowledge/decisions");await expect(page.getByRole("heading",{name:"검증된 결정을 채택합니다."})).toBeVisible();
 await expect(page.getByRole("heading",{name:"후속 확인 내용"})).toBeVisible();await expect(page.getByText("정정 — 추가 근거",{exact:true})).toBeVisible();
});
test("document APIs fail closed without a session",async({request})=>{
 for(const path of ["/api/v1/knowledge/workspace","/api/v1/knowledge/search?q=QA"]){expect((await request.get(path)).status()).toBe(401);}
 expect((await request.post("/api/v1/knowledge/workspace",{data:{action:"document.create",space:"team",title:"denied"}})).status()).toBe(401);
 for(const path of ["/api/v1/knowledge/trash/purge","/api/v1/knowledge/reminders"]){expect((await request.get(path)).status()).toBe(401);}
});

test("meeting import preserves content, autosaves, and saves before internal navigation",async({page})=>{
 await page.goto("/knowledge/meetings");await page.getByRole("button",{name:"새 회의",exact:true}).click();
 await page.getByRole("textbox",{name:"제목",exact:true}).fill("QA 파일 회의");await page.getByRole("button",{name:"만들기",exact:true}).click();
 const memo=page.getByRole("group",{name:"회의 메모",exact:true}).getByRole("textbox");await expect(memo).toBeVisible();
 const url=page.url();await memo.fill("기존 메모");
 await page.locator('input[type="file"]').setInputFiles({name:"qa-meeting.txt",mimeType:"text/plain",buffer:Buffer.from("가져온 합성 원문")});
 await expect(page.getByRole("textbox",{name:"가져온 원문 미리보기"})).toHaveValue("가져온 합성 원문");
 await page.getByRole("button",{name:"기존 메모 뒤에 추가"}).click();await expect(memo).toContainText("기존 메모");await expect(memo).toContainText("가져온 합성 원문");
 await expect(page.getByText("저장됨",{exact:true})).toBeVisible({timeout:5000});
 await page.reload();await expect(memo).toContainText("기존 메모");await expect(memo).toContainText("가져온 합성 원문");
 await memo.fill("이동 직전 추가 내용");await page.getByRole("link",{name:"회의 목록",exact:true}).click();
 await expect(page).toHaveURL(/\/knowledge\/meetings$/);await page.goto(url);await expect(memo).toContainText("이동 직전 추가 내용");
 await memo.fill("x".repeat(20000));
 await page.locator('input[type="file"]').setInputFiles({name:"qa-limit.txt",mimeType:"text/plain",buffer:Buffer.from("보존할 원문")});
 await page.getByRole("button",{name:"기존 메모 뒤에 추가"}).click();
 await expect(page.getByRole("textbox",{name:"가져온 원문 미리보기"})).toHaveValue("보존할 원문");
});

test("tag suggestions, no-version property save, archive and restore persist",async({page})=>{
 await createNote(page,"QA 태그 복원");
 await page.getByRole("textbox",{name:"태그 검색 또는 새 태그"}).fill("QA 새태그");
 await page.locator(".kw-tag-picker").getByRole("button",{name:"추가",exact:true}).click();
 await expect(page.getByRole("button",{name:"QA 새태그 태그 삭제"})).toBeVisible();
 await expect(page.locator(".kw-properties")).toContainText("버전 1");
 await page.reload();await expect(page.getByRole("button",{name:"QA 새태그 태그 삭제"})).toBeVisible();
 await page.getByRole("button",{name:"휴지통",exact:true}).click();
 await page.getByRole("dialog").getByRole("button",{name:"휴지통으로",exact:true}).click();
 await page.goto("/knowledge/trash");const row=page.getByRole("row").filter({hasText:"QA 태그 복원"});
 await row.getByRole("button",{name:"복원",exact:true}).click();
 await page.goto("/knowledge/notes?tab=all");await expect(page.getByRole("link",{name:"QA 태그 복원",exact:true})).toBeVisible();
});

test("inline document and people pickers respect visibility, keyboard insertion and child links",async({page})=>{
 const editor=await createNote(page,"QA 인라인 입력");
 await editor.pressSequentially("[[");
 const links=page.getByRole("listbox",{name:"문서 연결 제안"});await expect(links).toBeVisible();
 await links.getByRole("option",{name:/문서 작성 기준/}).click();
 await expect(editor).toContainText("[[example-canonical]]");
 await editor.pressSequentially(" @");
 const people=page.getByRole("listbox",{name:"사람 언급"});await expect(people).toBeVisible();
 await expect(people.getByRole("option",{name:/승인 담당자/})).toBeDisabled();
 await editor.press("Escape");await expect(people).toHaveCount(0);
 await editor.fill("prefix ");await editor.pressSequentially("/");
 await expect(page.getByRole("listbox",{name:"블록 종류"})).toBeVisible();
 await page.getByRole("option",{name:/하위 페이지/}).click();
 await expect(editor).toContainText("↳ [[");
 await page.getByRole("button",{name:"저장",exact:true}).click();await page.reload();await expect(editor).toContainText("↳ [[");
 await page.goto("/knowledge/doc/example-team-document");
 const teamEditor=page.getByRole("textbox",{name:"editable markdown"});await teamEditor.fill("검토 ");await teamEditor.pressSequentially("@");
 await page.getByRole("listbox",{name:"사람 언급"}).getByRole("option",{name:/승인 담당자/}).click();
 await expect(teamEditor).toContainText("@{example-approver|승인 담당자}");
 await page.getByRole("button",{name:"저장",exact:true}).click();await page.reload();await expect(teamEditor).toContainText("example-approver");
});

test("canonical proposal persists without changing the original, forbids self approval and supports withdrawal",async({page})=>{
 await page.goto("/knowledge/canon/example-canonical/propose");
 const editor=page.getByRole("textbox",{name:"editable markdown"});await editor.fill("QA 변경 제안 본문");
 await page.getByRole("textbox",{name:/변경 이유/}).fill("검증용 합성 변경");
 await page.getByRole("combobox",{name:"승인자",exact:true}).selectOption("example-approver");
 await page.getByRole("button",{name:"변경 제안 보내기"}).click();
 await expect(page).toHaveURL(/\/knowledge\/review\?tab=sent/);
 await expect(page.getByRole("button",{name:"변경 승인",exact:true})).toBeDisabled();
 await expect(page.locator(".kw-diff")).toContainText("QA 변경 제안 본문");
 await page.reload();await expect(page.locator(".kw-diff")).toContainText("QA 변경 제안 본문");
 await page.getByRole("button",{name:"철회",exact:true}).click();
 await page.goto("/knowledge/canon/example-canonical");
 await expect(page.locator(".document-reader")).not.toContainText("QA 변경 제안 본문");
 await expect(page.locator(".document-reader")).toContainText("목적과 근거");
});

test("graph filters, zoom, keyboard selection and reduced motion remain usable",async({page},info)=>{
 await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/knowledge/graph");
 const canvas=page.getByRole("application");await expect(canvas).toHaveAttribute("data-node-count","2");
 await page.getByRole("button",{name:"지도 확대",exact:true}).click();await expect(canvas).toHaveAttribute("data-zoom","1.25");
 await canvas.focus();await canvas.press("-");await expect(canvas).toHaveAttribute("data-zoom","1");
 await page.getByRole("textbox",{name:"문서 찾기",exact:true}).fill("문서 작성 기준");
 await page.getByRole("textbox",{name:"문서 찾기",exact:true}).press("Enter");
 await expect(page).toHaveURL(/sel=example-canonical/);await expect(page.getByRole("link",{name:"문서 열기"})).toBeVisible();
 await page.getByRole("checkbox",{name:/회사 정본/}).uncheck();await expect(canvas).toHaveAttribute("data-node-count","1");
 await page.getByRole("checkbox",{name:/회사 정본/}).check();
 await page.locator(".kw-root").screenshot({path:info.outputPath("graph-verified.png")});
});
