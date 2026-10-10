import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("brandy-os-menu-guide-final", "seen"); localStorage.setItem("brandy-os-guidance", "off"); });
});
function trackWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push(request.method() + " " + new URL(request.url()).pathname); });
  return writes;
}
async function create(page: Page, title = "QA 가상 문서") {
  await page.locator(".vault-toolbar").getByRole("button", { name: "새 페이지", exact: true }).click();
  await page.getByRole("textbox", { name: "새 페이지 제목" }).fill(title);
  await page.getByRole("textbox", { name: "editable markdown" }).fill("가상 테스트 본문");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "문서 제목", exact: true })).toHaveValue(title);
  return new URL(page.url()).searchParams.get("document")!;
}

test("empty root and nested folders persist locally without API writes, rename inline and delete locally", async ({ page }) => {
  const writes = trackWrites(page);
  await page.goto("/knowledge/vault");
  await page.getByRole("button", {name:"최상위 새 폴더",exact:true}).click();
  await page.getByRole("textbox", {name:"새 폴더 이름",exact:true}).fill("QA 고객");
  await page.getByRole("textbox", {name:"새 폴더 이름",exact:true}).press("Enter");
  const root = page.getByRole("treeitem", {name:"QA 고객 빈 폴더",exact:true});
  await expect(root).toHaveAttribute("aria-level", "1");
  await expect(page.getByRole("treeitem", {name:"회사 wiki 3",exact:true})).toBeVisible();
  await root.click({button:"right"});
  await page.getByRole("menuitem", {name:"새 하위 폴더",exact:true}).click();
  await page.getByRole("textbox", {name:"새 폴더 이름",exact:true}).fill("하위");
  await page.getByRole("textbox", {name:"새 폴더 이름",exact:true}).press("Enter");
  await expect(page.getByRole("treeitem", {name:"하위 빈 폴더",exact:true})).toHaveAttribute("aria-level", "2");
  await root.press("F2");
  await expect(page.getByRole("dialog", {name:"문서 이름 변경",exact:true})).toHaveCount(0);
  await page.getByRole("textbox", {name:"이름 변경",exact:true}).fill("QA 변경");
  await page.getByRole("textbox", {name:"이름 변경",exact:true}).press("Enter");
  await page.reload();
  await expect(page.getByRole("treeitem", {name:"QA 변경 빈 폴더",exact:true})).toBeVisible();
  await page.getByRole("treeitem", {name:"QA 변경 빈 폴더",exact:true}).click({button:"right"});
  await page.getByRole("menuitem", {name:/^폴더 문서 휴지통으로/}).click();
  await expect(page.getByRole("treeitem", {name:"QA 변경 빈 폴더",exact:true})).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("mixed modifier selections expose one move bar and a searchable chooser", async ({ page }) => {
  await page.goto("/knowledge/vault");
  await page.getByRole("button",{name:"회사 wiki 펼치기",exact:true}).click();
  const tree = page.getByRole("tree",{name:"문서와 하위 페이지"});
  const rows = tree.getByRole("treeitem");
  for (const index of [0, 1, 2]) await rows.nth(index).click({modifiers:["ControlOrMeta"]});
  const bar = page.getByRole("region",{name:"선택 항목 작업"});
  await expect(bar).toContainText("3개 선택");
  await bar.getByRole("button",{name:"이동",exact:true}).click();
  const dialog = page.getByRole("dialog",{name:"문서 위치 이동",exact:true});
  await dialog.getByRole("textbox",{name:"이동할 폴더 검색",exact:true}).fill("Projects");
  await expect(dialog.getByRole("treeitem",{name:"05_Projects",exact:true})).toBeVisible();
  await dialog.getByRole("button",{name:"닫기",exact:true}).click();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("new pages do not write before explicit save and empty title saves as untitled", async ({ page }) => {
  const writes = trackWrites(page);
  await page.goto("/knowledge/vault");
  await page.locator(".vault-toolbar").getByRole("button",{name:"새 페이지",exact:true}).click();
  await page.getByRole("textbox",{name:"새 페이지 제목"}).press("Enter");
  await expect(page.getByRole("textbox",{name:"editable markdown"})).toBeFocused();
  await page.getByRole("textbox",{name:"editable markdown"}).fill("임시 본문");
  expect(writes).toEqual([]);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("textbox",{name:"문서 제목",exact:true})).toHaveValue("제목 없음");
  await expect(page.locator(".vault-save-status")).toHaveText("저장됨 · v1");
  expect(writes).toEqual([]);
});

test("automatic edit, local draft recovery, explicit save, slash 17 and initial search", async ({ page }) => {
  const writes = trackWrites(page);
  await page.goto("/knowledge/vault");
  await page.goto("/knowledge/vault?document=demo-workflow");
  const title = page.getByRole("textbox",{name:"문서 제목",exact:true});
  await expect(title).toBeVisible();
  const original = await title.inputValue();
  const id = new URL(page.url()).searchParams.get("document")!;
  await title.fill("QA 복구 제목");
  const editor=page.getByRole("textbox",{name:"editable markdown"});
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.press("Backspace");
  await expect(editor).toHaveText("");
  // Korean IME commits text through input, not synthesized per-character keypresses.
  await page.keyboard.insertText("임시 복구 본문");
  await expect(editor).toContainText("임시 복구 본문");
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem(`brandy-vault-v2-draft:${id}`) || "null")?.draft.title,id)).toBe("QA 복구 제목");
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem(`brandy-vault-v2-draft:${id}`) || "null")?.draft.content,id)).toContain("임시 복구 본문");
  await page.evaluate(id => { const key=`brandy-vault-v2-draft:${id}`, stored=JSON.parse(localStorage.getItem(key)!); stored.baseVersion=1; localStorage.setItem(key,JSON.stringify(stored)); },id);
  await page.goto("/home"); // full navigation deliberately simulates browser closing after local persistence
  await page.goto(`/knowledge/vault?document=${id}`);
  await expect(page.locator(".vault-recovery")).toBeVisible();
  await page.getByRole("button",{name:"이어 쓰기",exact:true}).click();
  const comparison=page.getByRole("dialog",{name:"저장 충돌 · 작성 내용 유지됨",exact:true});
  await expect(comparison).toBeVisible();
  await comparison.getByRole("button",{name:"내 내용을 유지하고 최신 버전 기준으로 계속 편집",exact:true}).click();
  await expect(title).toHaveValue("QA 복구 제목");
  await expect(editor).toContainText("임시 복구 본문");
  await title.fill(original);
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.press("Backspace");
  await expect(editor).toHaveText("");
  await editor.press("/");
  await expect(page.locator(".knowledge-block-picker").getByRole("option")).toHaveCount(17);
  await page.getByRole("textbox",{name:"블록 찾기",exact:true}).fill("ㅍ");
  await expect(page.locator(".knowledge-block-picker").getByRole("option",{name:/^표/})).toBeVisible();
  await page.getByRole("textbox",{name:"블록 찾기",exact:true}).press("Escape");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".vault-save-status")).toContainText("저장됨");
  await expect.poll(() => page.evaluate(id => localStorage.getItem(`brandy-vault-v2-draft:${id}`),id)).toBeNull();
  expect(writes).toEqual([]);
});

test("folder inline rename reuses path plan without an input modal and retains document IDs", async ({page}) => {
  const writes=trackWrites(page);
  await page.goto("/knowledge/vault");
  await page.getByRole("treeitem",{name:"회사 wiki 3",exact:true}).press("F2");
  await page.getByRole("textbox",{name:"이름 변경",exact:true}).fill("QA 위키");
  await page.getByRole("textbox",{name:"이름 변경",exact:true}).press("Enter");
  const result=page.getByRole("dialog",{name:"폴더 경로 변경",exact:true});
  await expect(result.getByRole("status")).toContainText("3개 완료 · 0개 실패");
  await expect(result.getByRole("textbox")).toHaveCount(0);
  await result.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page.getByRole("treeitem",{name:"QA 위키 3",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"문서·폴더 찾기",exact:true}).click();
  await page.getByRole("button").filter({hasText:"패키징 원칙"}).last().click();
  await expect(page).toHaveURL(/document=demo-packaging/);
  expect(writes).toEqual([]);
});

test("empty folder move changes only this browser and rejects self descendants", async ({page}) => {
  const writes=trackWrites(page);
  await page.goto("/knowledge/vault");
  await page.getByRole("button",{name:"최상위 새 폴더",exact:true}).click();
  await page.getByRole("textbox",{name:"새 폴더 이름",exact:true}).fill("QA 이동");
  await page.getByRole("textbox",{name:"새 폴더 이름",exact:true}).press("Enter");
  await page.getByRole("treeitem",{name:"QA 이동 빈 폴더",exact:true}).click({button:"right"});
  await page.getByRole("menuitem",{name:/위치 이동/}).click();
  const dialog=page.getByRole("dialog",{name:"폴더 관리",exact:true});
  await expect(dialog.getByRole("treeitem",{name:"QA 이동",exact:true})).toBeDisabled();
  await dialog.getByRole("treeitem",{name:"회사 wiki",exact:true}).dblclick();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button",{name:"회사 wiki 펼치기",exact:true}).click();
  await expect(page.getByRole("treeitem",{name:"QA 이동 빈 폴더",exact:true})).toHaveAttribute("aria-level","2");
  expect(writes).toEqual([]);
});

test("drag document into a folder offers one undo and restores the original location", async ({page}) => {
  const writes=trackWrites(page);
  await page.goto("/knowledge/vault?document=demo-workflow");
  // Headless macOS native drag can stall in Chromium; dispatch the same HTML5
  // drag payload and validate the drop indicator, update and undo end to end.
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.getByRole("treeitem").filter({hasText:"지식 정본 승격 절차"}).dispatchEvent("dragstart",{dataTransfer:transfer});
  await expect(page.getByText("최상위로 이동",{exact:true})).toBeVisible();
  const target=page.getByRole("treeitem",{name:"리키 1",exact:true});
  await target.dispatchEvent("dragenter",{dataTransfer:transfer});
  await expect(page.getByText("리키 안으로",{exact:true})).toBeVisible();
  await target.dispatchEvent("drop",{dataTransfer:transfer});
  await expect(page.locator(".vault-move-undo")).toBeVisible();
  await page.locator(".vault-move-undo").getByRole("button",{name:"되돌리기",exact:true}).click();
  await expect(page.locator(".vault-move-undo")).toHaveCount(0);
  await expect(page.getByRole("navigation",{name:"문서 경로"})).toContainText("운영 원칙");
  expect(writes).toEqual([]);
});

test("canonical and review documents remain read only, tree rows are 30px and help is reachable", async ({page}) => {
  await page.goto("/knowledge/vault?document=demo-packaging");
  await expect(page.getByRole("textbox",{name:"문서 제목",exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"변경 제안 작성",exact:true})).toBeVisible();
  await page.goto("/knowledge/vault?document=demo-telegram");
  await expect(page.getByRole("textbox",{name:"문서 제목",exact:true})).toHaveCount(0);
  await expect(page.locator(".vault-readonly-hint")).toBeVisible();
  const row=page.getByRole("treeitem",{name:"리키 1",exact:true});
  expect(await row.evaluate(node=>node.getBoundingClientRect().height)).toBe(30);
  await row.press("ArrowDown");
  await expect(page.getByRole("treeitem",{name:"작업 중 1",exact:true})).toBeFocused();
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  await page.getByRole("button",{name:"사용법·단축키",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"문서 보관함 사용법·단축키",exact:true})).toContainText("임시 보관은 이 기기에만");
});

test("renaming a folder with more than 20 documents requires explicit impact confirmation",async({page})=>{
  test.setTimeout(120000);
  const writes=trackWrites(page);
  await page.goto("/knowledge/vault");
  await page.getByRole("treeitem",{name:"리키 1",exact:true}).click();
  for(let index=0;index<20;index++) await create(page,`가상 문서 ${index+1}`);
  await page.getByRole("treeitem",{name:"리키 21",exact:true}).press("F2");
  await page.getByRole("textbox",{name:"이름 변경",exact:true}).fill("QA 검토 폴더");
  await page.getByRole("textbox",{name:"이름 변경",exact:true}).press("Enter");
  const dialog=page.getByRole("dialog",{name:"폴더 경로 변경",exact:true});
  await expect(dialog).toContainText("문서 21개의 경로가 함께 바뀝니다.");
  await expect(dialog).toContainText("내용과 문서 연결(고유 ID)은 그대로입니다.");
  await expect(page.getByRole("treeitem",{name:"리키 21",exact:true})).toBeVisible();
  await dialog.getByRole("button",{name:"확인한 21개 이동",exact:true}).click();
  await expect(dialog.getByRole("status")).toContainText("21개 완료 · 0개 실패");
  expect(writes).toEqual([]);
});

for (const theme of ["light","dark"]) for (const width of [1440,1024,390]) test(`vault layout ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(theme=>localStorage.setItem("brandy-os-theme",theme),theme);
  await page.goto("/knowledge/vault");
  await create(page);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  const gap = await page.evaluate(()=>{const a=document.querySelector(".vault-toolbar")!.getBoundingClientRect(),b=document.querySelector(".vault-workspace")!.getBoundingClientRect();return Math.round(b.top-a.bottom);});
  expect(gap).toBe(0);
  const editSize=await page.locator(".title-input").evaluate(node=>getComputedStyle(node).fontSize);
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  await page.getByRole("button",{name:"읽기 미리보기",exact:true}).click();
  const readSize=await page.locator(".document-reader > h1").evaluate(node=>getComputedStyle(node).fontSize);
  expect(editSize).toBe(readSize);
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  await page.screenshot({path:info.outputPath(`vault-${theme}-${width}.png`),fullPage:true});
});

test("admin demo allows every enabled OS menu including finance and settings",async({page},info)=>{
  test.setTimeout(180000);
  const writes=trackWrites(page), failures:string[]=[];
  page.on("pageerror",error=>failures.push(error.message));
  await page.setViewportSize({width:1440,height:1000});
  await page.goto("/knowledge/vault");
  const nav=page.getByRole("navigation").first();
  const groups=["유튜브 공정","콘텐츠 자동화","팀",...(process.env.HR_E2E_DEMO==="true"?["인사 노무 관리"]:[]),"재무관리","개발","설정"];
  for(const label of groups) await nav.getByRole("button",{name:label,exact:true}).click();
  const links = await nav.locator("a[href]").evaluateAll(items=>items.map(item=>({name:item.textContent?.trim(),href:item.getAttribute("href")!})));
  expect(links.length).toBeGreaterThanOrEqual(40);
  for(const {href} of links){
    await page.goto(href);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("이 메뉴에 접근 권한이 없습니다.",{exact:true})).toHaveCount(0);
    await expect(page.getByText("메뉴 권한을 확인하지 못했습니다.",{exact:true})).toHaveCount(0);
  }
  expect(writes).toEqual([]);expect(failures).toEqual([]);
  await page.goto("/knowledge/vault");
  await page.screenshot({path:info.outputPath("admin-all-menus.png"),fullPage:true});
});
