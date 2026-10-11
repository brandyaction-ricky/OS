import { expect, test } from "@playwright/test";

test("local demo renders the application shell and health contract", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/home");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/확인할 일 \d+건/);
  await expect(page.getByText("데모 · 실제 일정 연결 전", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "지식 찾기" })).toBeVisible();

  const healthResponse = await request.get("/api/v1/health");
  expect(healthResponse.status()).toBe(200);
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "brandyaction-os",
    database: "missing",
    auth: "missing",
  });

  expect(consoleErrors).toEqual([]);
});

test("secondary publishing pages keep their current navigation context", async ({ page }) => {
  for (const [pathname, group, title] of [
    ["/content/automation", "콘텐츠 자동화", "주제 기획"],
    ["/content/review", "콘텐츠 자동화", "최종 확인"],
    ["/content/calendar", "유튜브 공정", "발행·업로드"],
  ]) {
    await page.goto(pathname);
    await expect(page.getByRole("button", { name: group, exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".breadcrumbs")).toContainText(title);
    await expect(page.getByRole("link", { name: title, exact: true }).last()).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(`${title} | 브랜디 OS`);
  }
});

test("knowledge editing applies Markdown shortcuts in one pane and exposes file drop", async ({ page }) => {
  await page.goto("/knowledge/doc/example-team-document");

  const richEditor = page.getByRole("textbox", { name: "editable markdown" });
  const richToolbar = page.getByRole("toolbar");
  await expect(richToolbar.getByRole("combobox", { name: "문단 형식" })).toBeVisible();
  await expect(richToolbar.getByRole("radio", { name: "굵게" })).toBeVisible();
  await expect(richToolbar.getByRole("button", { name: "표" })).toBeVisible();
  await expect(richToolbar).toHaveCSS("display", "flex");
  await expect(richToolbar).toHaveCSS("flex-direction", "row");
  await richEditor.click();
  await richEditor.press("ControlOrMeta+A");
  await richEditor.press("Backspace");
  await richEditor.pressSequentially("##");
  await richEditor.press("Space");
  await richEditor.pressSequentially("큰 제목");
  await expect(richEditor.getByRole("heading", { name: "큰 제목", level: 2 })).toBeVisible();
  await richEditor.press("Enter");
  await richEditor.pressSequentially("-");
  await richEditor.press("Space");
  await richEditor.pressSequentially("목록");
  await expect(richEditor.getByRole("list").getByText("목록", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "문서 연결", exact: true }).click();
  const linkDialog = page.getByRole("dialog", { name: "문서 연결" });
  await linkDialog.getByRole("button", { name: /문서 작성 기준/ }).click();
  await expect(richEditor).toContainText("example-canonical");

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["preview"], "preview.png", { type: "image/png" }));
    return transfer;
  });
  const editor = page.locator(".kw-editor-card");
  const headingBox = await richEditor.getByRole("heading", { name: "큰 제목", level: 2 }).boundingBox();
  expect(headingBox).not.toBeNull();
  const dropPoint = {
    clientX: headingBox!.x + headingBox!.width - 3,
    clientY: headingBox!.y + headingBox!.height + 2,
  };
  await editor.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("여기에 놓아 자료 첨부", { exact: true })).toBeVisible();
  await editor.dispatchEvent("dragover", { dataTransfer, ...dropPoint });
  await expect(page.locator(".knowledge-image-drop-indicator")).toBeVisible();
  await editor.dispatchEvent("drop", { dataTransfer, ...dropPoint });
  await expect(page.getByText("첨부 파일 저장은 연결된 개발 환경에서 검증합니다. 데모에서는 외부 저장소를 호출하지 않습니다.", { exact: true })).toBeVisible();
  await richEditor.pressSequentially("드롭 위치");
  await expect(richEditor.getByRole("heading", { level: 2 })).not.toContainText("드롭 위치");
  const dropBlocks = await richEditor.locator(":scope > *").evaluateAll((elements) => elements.slice(0, 3).map((element) => ({
    tag: element.tagName,
    text: element.textContent,
  })));
  expect(dropBlocks).toEqual([
    { tag: "H2", text: "큰 제목" },
    { tag: "P", text: "드롭 위치" },
    { tag: "UL", text: "목록[[example-canonical]]" },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  const [editorBox, viewportWidth] = await Promise.all([
    page.locator(".kw-editor-card").boundingBox(),
    page.evaluate(() => document.documentElement.clientWidth),
  ]);
  expect(editorBox).not.toBeNull();
  expect(editorBox!.width).toBeLessThanOrEqual(viewportWidth);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "저장" }).click();
  await page.reload();await expect(richEditor).toContainText("example-canonical");
});

test("knowledge image drop events move images between document blocks", async ({ page }) => {
  await page.goto("/knowledge/doc/example-team-document");

  const richEditor = page.getByRole("textbox", { name: "editable markdown" });
  await richEditor.click();
  await richEditor.press("ControlOrMeta+A");
  await richEditor.press("Backspace");
  await richEditor.pressSequentially("##");
  await richEditor.press("Space");
  await richEditor.pressSequentially("이동 기준");
  await richEditor.press("Enter");
  await richEditor.pressSequentially("아래 문단");
  await richEditor.press("Enter");
  await richEditor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", '<img src="/favicon.ico" alt="이동할 이미지">');
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });

  const image = richEditor.getByRole("img", { name: "이동할 이미지" });
  await expect(image).toHaveAttribute("draggable", "true");
  await image.click();
  const target = await richEditor.getByRole("heading", { name: "이동 기준", level: 2 }).boundingBox();
  expect(target).not.toBeNull();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await image.dispatchEvent("dragstart", { dataTransfer });
  await richEditor.getByRole("heading", { name: "이동 기준", level: 2 }).dispatchEvent("dragover", { dataTransfer, clientY: target!.y + target!.height });
  await richEditor.getByRole("heading", { name: "이동 기준", level: 2 }).dispatchEvent("drop", { dataTransfer, clientY: target!.y + target!.height });
  await expect(page.getByText("여기에 놓아 자료 첨부", { exact: true })).toBeHidden();
  const blocks = await richEditor.locator(":scope > *").evaluateAll((elements) => elements.map((element) => ({
    tag: element.tagName,
    image: Boolean(element.querySelector("img")),
  })));
  expect(blocks.slice(0, 3)).toEqual([
    { tag: "H2", image: false },
    { tag: "P", image: true },
    { tag: "P", image: false },
  ]);
});

test("knowledge gallery filters documents and stops image recovery before upload", async ({ page }) => {
  await page.goto("/knowledge/docs");
  await page.getByRole("button",{name:"갤러리 보기"}).click();
  await expect(page.locator(".kw-gallery").getByRole("link",{name:"프로젝트 시작 가이드"})).toBeVisible();
  await page.getByRole("button",{name:"표 보기",exact:true}).click();
  await expect(page.getByRole("table").getByText("프로젝트 시작 가이드")).toBeVisible();
  const search=page.getByRole("textbox",{name:"문서 검색",exact:true});
  await search.fill("시작");await search.press("Enter");
  await expect(page.getByRole("table").getByText("프로젝트 시작 가이드")).toBeVisible();
  await search.fill("없는 문서");await search.press("Enter");
  await expect(page.getByText("조건에 맞는 문서가 없습니다",{exact:true})).toBeVisible();
  await search.fill("");await search.press("Enter");
  await page.getByRole("button",{name:"갤러리 보기"}).click();
  await page.getByRole("button",{name:"원본 이미지 복원"}).click();
  const recovery=page.getByRole("dialog",{name:"원본 이미지 복원"});
  await expect(recovery.getByText("현재 범위에 연결이 필요한 로컬 이미지가 없습니다.",{exact:true})).toBeVisible();
  await expect(recovery.getByRole("button",{name:"0개 이미지 연결"})).toBeDisabled();
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("knowledge file tree is explicit and compact on desktop and mobile", async ({ page }) => {
  await page.goto("/knowledge/doc/example-team-document");
  const tree=page.getByRole("complementary",{name:"문서 파일 트리"});
  await expect(tree).toHaveCount(0);
  await page.getByRole("button",{name:"파일 트리 보기"}).click();
  await expect(tree.getByRole("link",{name:"프로젝트 시작 가이드",exact:true})).toHaveAttribute("aria-current","page");
  await page.setViewportSize({width:390,height:844});
  await expect(tree).toBeVisible();
  expect((await tree.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button",{name:"파일 트리 숨기기"}).click();
  await expect(tree).toHaveCount(0);
  await expect(page.getByRole("button",{name:"파일 첨부"})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("categories support rename, direct drag, undo and archive without deleting documents", async ({ page }) => {
  await page.goto("/knowledge/docs");
  await page.getByRole("button",{name:"카테고리 추가",exact:true}).click();
  let dialog=page.getByRole("dialog",{name:"카테고리 추가"});
  await dialog.getByRole("textbox",{name:"이름",exact:true}).fill("QA 분류");
  await dialog.getByRole("button",{name:"추가",exact:true}).click();
  await page.getByRole("button",{name:"카테고리 관리"}).click();
  dialog=page.getByRole("dialog",{name:"카테고리 관리"});
  await dialog.getByRole("textbox",{name:"카테고리 이름"}).last().fill("QA 분류 수정");
  await dialog.getByRole("button",{name:"저장",exact:true}).click();
  await page.getByRole("button",{name:"갤러리 보기"}).click();
  const card=page.locator(".kw-gallery article").filter({hasText:"프로젝트 시작 가이드"});
  const category=page.locator(".kw-categories").getByRole("button",{name:/QA 분류 수정/});
  await card.dragTo(category);
  await expect(category).toContainText("1");
  await page.getByRole("button",{name:"실행 취소",exact:true}).click();
  await expect(category).toContainText("0");
  await card.dragTo(category);
  await page.getByRole("button",{name:"카테고리 관리"}).click();
  dialog=page.getByRole("dialog",{name:"카테고리 관리"});
  await dialog.locator("section").last().getByRole("button",{name:"삭제",exact:true}).click();
  await dialog.getByRole("button",{name:"저장",exact:true}).click();
  await expect(category).toHaveCount(0);
  await expect(card).toContainText("미분류");
  await card.getByRole("link").click();
  await page.getByRole("textbox",{name:"문서 제목"}).fill("QA 이름 변경");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await page.reload();await expect(page.getByRole("textbox",{name:"문서 제목"})).toHaveValue("QA 이름 변경");
  await page.getByRole("button",{name:"휴지통",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"휴지통으로",exact:true}).click();
  await page.goto("/knowledge/trash");
  await expect(page.getByText("QA 이름 변경",{exact:true})).toBeVisible();
});

test("new page keeps title, toggle and nested page actions in one workspace", async ({ page }) => {
  await page.goto("/knowledge/notes?new=1&tab=all");
  await page.getByRole("textbox",{name:"제목",exact:true}).fill("페이지 편집 QA");
  await page.getByRole("button",{name:"만들기",exact:true}).click();
  const editor=page.getByRole("textbox",{name:"editable markdown"});
  await editor.fill("본문 문단");
  await page.getByRole("button",{name:"블록 추가"}).click();
  await page.getByRole("option",{name:/토글 목록/}).click();
  await page.getByRole("textbox",{name:"토글 제목"}).fill("접기 테스트");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await page.reload();await expect(page.getByRole("textbox",{name:"토글 제목"})).toHaveValue("접기 테스트");
  await page.getByRole("button",{name:"토글 접기"}).click();
  await expect(page.getByRole("button",{name:"토글 펼치기"})).toHaveAttribute("aria-expanded","false");
  await page.getByRole("button",{name:"토글 펼치기"}).click();
  await page.getByRole("button",{name:"블록 추가"}).click();
  await page.getByRole("option",{name:/하위 페이지/}).click();
  await page.getByRole("button",{name:"파일 트리 보기"}).click();
  const tree=page.getByRole("complementary",{name:"문서 파일 트리"});
  await expect(tree.getByRole("link",{name:"↳ 새 하위 페이지",exact:true})).toBeVisible();
  await tree.getByRole("button",{name:"페이지 편집 QA 하위 페이지 접기"}).click();
  await expect(tree.getByRole("link",{name:"↳ 새 하위 페이지",exact:true})).toHaveCount(0);
  await tree.getByRole("button",{name:"페이지 편집 QA 하위 페이지 펼치기"}).click();
  await tree.getByRole("link",{name:"↳ 새 하위 페이지",exact:true}).click();
  await page.getByRole("textbox",{name:"문서 제목"}).fill("QA 하위 페이지");
  await editor.fill("자식 본문");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await page.reload();await expect(editor).toContainText("자식 본문");
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"블록 추가"}).click();
  await expect(page.getByRole("listbox",{name:"블록 종류"})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
