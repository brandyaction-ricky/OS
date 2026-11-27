import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Requires the isolated YouTube-process demo.");
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});
const startUrl = "/content/projects?view=discover&platform=card";
const editUrl = "/content/plan?project=demo-p13&view=draft";
test("card library distinguishes format, editorial category and workflow on desktop and mobile", async ({ page }) => {
  await page.goto("/content/projects?platform=card");
  const categories = page.getByRole("group", { name: "카테고리", exact: true });
  const row = page.locator(".yp-library-list .yp-mv").first();
  const category = row.getByRole("combobox", { name: /카테고리 변경/ });
  await expect(categories.getByRole("button", { name: /정보전달형.*1/ })).toBeVisible();
  await expect(row.locator(".yp-library-format")).toHaveText(/정리형 · \d+장/);
  await expect(row.getByRole("link", { name: /카드 만들기/ })).toBeVisible();
  await category.selectOption("story");
  await expect(categories.getByRole("button", { name: /스토리형.*1/ })).toBeVisible();
  await categories.getByRole("button", { name: /정보전달형/ }).click();
  await expect(page.getByRole("button", { name: "전체 카테고리 보기" })).toBeVisible();
  await categories.getByRole("button", { name: /스토리형/ }).click();
  await expect(page).toHaveURL(/category=story/);
  await expect(category).toHaveValue("story");
  await page.getByLabel("카드뉴스 검색").fill("검색 결과 없음");
  await expect(categories.getByRole("button", { name: /스토리형.*0/ })).toBeVisible();
  await page.getByLabel("카드뉴스 검색").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row.locator(".yp-mv-t")).toBeVisible();
  const overflow = await row.evaluate(el => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBe(false);
  await category.selectOption("");
  await expect(page.getByRole("button", { name: "전체 카테고리 보기" })).toBeVisible();
  await page.getByRole("button", { name: "전체 카테고리 보기" }).click();
  await expect(row.locator(".yp-library-badge")).toContainText("정보전달형");
  await page.getByLabel("영상 플랫폼").selectOption("short");
  await expect(categories).toHaveCount(0);
  await expect(page.locator(".yp-pf-short").first()).toBeVisible();
});
test("the card category remains visible through trash and restore", async ({ page }) => {
  await page.goto("/content/projects?platform=card");
  const rows = page.locator(".yp-library-list .yp-mv");
  await rows.first().getByRole("combobox", { name: /카테고리 변경/ }).selectOption("guide");
  await expect(rows.first().getByRole("combobox")).toHaveValue("guide");
  await rows.first().getByRole("button", { name: /삭제$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "휴지통으로", exact: true }).click();
  await page.getByRole("tab", { name: /휴지통 1/ }).click();
  await page.getByRole("group", { name: "카테고리" }).getByRole("button", { name: /안내형.*1/ }).click();
  await expect(rows.first().locator(".yp-library-badge")).toHaveText("안내형");
  await rows.first().getByRole("button", { name: "복구" }).click();
  await page.getByRole("tab", { name: /진행 중 1/ }).click();
  await expect(rows.first().getByRole("combobox")).toHaveValue("guide");
});
async function editor(page: Page) { await page.goto(editUrl); await expect(page.getByRole("button", { name: "1장 보기", exact: true })).toBeVisible(); }

test("card catalog shows its cover, completed tab and title search", async ({ page }) => {
  await page.goto(startUrl);
  await expect(page.locator(".yp-card-catalog .yp-card-pv")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /완료된 카드뉴스/ })).toBeVisible();
  await page.getByRole("tab", { name: /완료된 카드뉴스/ }).click();
  await expect(page.getByText("아직 없어요.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /만드는 중인 카드뉴스/ }).click();
  await page.getByLabel("카드뉴스 검색").fill("존재하지 않는 제목");
  await expect(page.getByText("찾는 카드뉴스가 없어요.")).toBeVisible();
  await page.getByLabel("카드뉴스 검색").fill("월요일");
  await expect(page.locator(".yp-card-catalog .yp-card-pv")).toHaveCount(1);
});

for (const [kind, query, summary] of [["longform", "고객 인터뷰", "롱폼"], ["short", "일이 안 맞을", "숏폼"], ["threads", "스레드", "스레드"]]) {
  test(`an approved ${kind} topic can start a new card without editing the source`, async ({ page }) => {
    await page.goto(startUrl);
    await page.getByRole("button", { name: "완료한 주제 가져오기", exact: true }).click();
    const picker = page.getByRole("region", { name: "완료한 주제 가져오기" });
    await picker.getByLabel("원본 유형").selectOption(kind);
    await picker.getByLabel("가져올 주제 검색").fill(query);
    await expect(picker.locator(".yp-source-list li")).toHaveCount(1);
    await picker.getByRole("button", { name: /가져오기$/ }).click();
    await picker.getByLabel("이 부분 위주로").fill("실행할 한 가지");
    await picker.getByRole("button", { name: "이 콘텐츠로 시작" }).click();
    await expect(page.getByRole("region", { name: "현재 제작 기준" })).toContainText("실행할 한 가지");
    await expect(page).toHaveURL(/project=demo-.+&view=draft/);
    await expect(page.getByRole("heading", { name: "카드 만들기", exact: true })).toBeVisible();
    await expect(page.locator(".yp-card-src summary")).toContainText(`원본 · ${summary}`);
    await expect(page.getByRole("checkbox", { name: "정리형" })).toBeVisible();
  });
}

test("a *marked* phrase shows in the accent colour and its stars are not counted", async ({ page }) => {
  await editor(page);
  await page.getByLabel("헤드 카피", { exact: true }).fill("연봉이 *덜 지칠까요*");
  await expect(page.locator(".yp-card-big [data-card-field=head] span").filter({ hasText: "지칠까요" })).toHaveCSS("color", "rgb(238, 212, 103)");
  await expect(page.locator(".yp-card-fields .yp-card-n").first()).toHaveText(/^10\//);
});

// A 30 × 20 grey PNG (Chromium's createImageBitmap refuses the 1 × 1 one other tests upload).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAB4AAAAUCAIAAAAVyRqTAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAKUlEQVQ4jWOYtXgrjRDDqNGLRwNk62gKmTWaZRaPliFbRwvVWUOrlgEAt4+PbaDlegEAAAAASUVORK5CYII=";
test("a photo goes on a card and comes off again", async ({ page }) => {
  await editor(page);
  await page.getByRole("button", { name: "2장 보기", exact: true }).click();
  await page.getByLabel("사진 파일").setInputFiles({ name: "현장.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await expect(page.locator(".yp-card-big img")).toBeVisible();
  await page.getByRole("button", { name: "사진 빼기", exact: true }).click();
  await expect(page.locator(".yp-card-big img")).toHaveCount(0);
});

// 카드 그림 (대표 2026-11-02): the PD writes a scene, the cost is asked first, the picture lands on the card, and it can be kept in the
// 캐릭터 창고 to draw the same face from next time (the demo draws a grey 「연습 그림」 board instead of calling GPT).
test("a picture is drawn with AI after the cost ask and kept as a character", async ({ page }) => {
  await editor(page);
  await page.getByRole("button", { name: "2장 보기", exact: true }).click();
  await page.getByRole("button", { name: "AI로 그리기", exact: true }).click();
  const panel = page.getByRole("group", { name: "AI로 그리기" });
  await expect(panel.getByText(/아직 없어요/)).toBeVisible();
  await expect(panel.locator(".cost-tag-paid")).toContainText("원");
  await panel.getByLabel("장면 설명").fill("밤 11시 사무실, 한결이 모니터 앞에서 웃어요");
  await panel.getByRole("button", { name: "그리기", exact: true }).click();
  const ask = page.locator("dialog.cost-dlg");
  await expect(ask).toContainText("GPT Image 2.5 Flare");
  await ask.getByRole("button", { name: "그리기", exact: true }).click();
  await expect(page.locator(".yp-card-big img")).toBeVisible();
  await panel.getByLabel("캐릭터 이름").fill("한결 앞모습");
  await panel.getByRole("button", { name: "캐릭터로 저장", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "한결 앞모습" })).toBeVisible();
  await panel.getByRole("checkbox", { name: "한결 앞모습" }).check();
  await expect(panel.getByRole("button", { name: "다시 그리기", exact: true })).toBeEnabled();
});

// 웹툰형 (대표 2026-11-02): a 칸 is a picture with words on it; its 장면 goes to 「AI로 그리기」 (그림체 웹툰) and 카드 확정 waits for the pictures.
test("a 웹툰 화 starts by hand and each 칸 brings its 장면 to the drawing panel", async ({ page }) => {
  await editor(page);
  await page.getByRole("checkbox", { name: "웹툰형", exact: true }).check();
  await page.getByRole("button", { name: "직접 쓰기", exact: true }).click();
  const row = page.locator(".yp-card-row", { has: page.locator(".yp-card-row-h b", { hasText: "웹툰형" }) });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "이 초안으로 다듬기", exact: true }).click();
  await expect(page.getByText("웹툰형 · 8장")).toBeVisible();
  await page.getByRole("button", { name: "2장 보기", exact: true }).click();
  await expect(page.locator(".yp-card-big")).toContainText("그림 자리");
  await page.getByLabel("장면 (그릴 것)", { exact: true }).fill("밤 11시 사무실, 서윤이 모니터 앞에서 웃는다");
  await page.getByLabel("대사", { exact: true }).fill("네, 괜찮아요!");
  await expect(page.locator(".yp-card-big [data-card-field=talk]")).toHaveText("네, 괜찮아요!");
  // 받는 대사 answers the 대사, so it sits below it: read top to bottom, the answer came first (대표 2026-11-09, 사건 1).
  await page.getByLabel("받는 대사", { exact: true }).fill("진짜?");
  const top = (name: string) => page.locator(`.yp-card-big [data-card-field=${name}]`).evaluate(field => field.getBoundingClientRect().top);
  expect(await top("talk")).toBeLessThan(await top("reply"));
  await page.getByLabel("받는 대사", { exact: true }).fill("");
  // The tilted 효과음 letters reach past their box; that must not count as 넘침 (it would block 카드 확정).
  await page.getByLabel("효과음", { exact: true }).fill("빼꼼");
  // The 해설 hexagon and the 속마음 oval are pictures behind their words; the words must paint on top in the preview (hidden till 2026-11-09).
  const wordsOnTop = (name: string) => page.locator(`.yp-card-big [data-card-field=${name}]`).evaluate(field => {
    field.scrollIntoView({ block: "center" });   // clear of the sticky step bar
    const box = field.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return Boolean(hit && field.contains(hit));
  });
  await page.getByLabel("해설 상자", { exact: true }).fill("밤 11시");
  expect(await wordsOnTop("narration")).toBe(true);
  await page.getByLabel("속마음", { exact: true }).fill("근데 나 왜\n또 괜찮다고 했지?");
  expect(await wordsOnTop("think")).toBe(true);
  await expect(page.getByRole("button", { name: "2장 보기", exact: true })).not.toContainText("넘침");
  await expect(page.locator(".yp-card-issues")).not.toContainText("넘쳐요");
  await expect(page.getByRole("button", { name: "내 GPT로 그리기" })).toBeVisible();   // beside 「AI로 그리기」 before the panel opens
  await page.getByRole("button", { name: "AI로 그리기", exact: true }).click();
  const panel = page.getByRole("group", { name: "AI로 그리기" });
  await expect(panel.getByLabel("장면 설명")).toHaveValue("밤 11시 사무실, 서윤이 모니터 앞에서 웃는다");
  await expect(panel.getByLabel("그림체")).toHaveValue("webtoon");
  // 「내 GPT로 그리기」: three steps; where the clipboard is closed (Playwright, the app's own pane) the words open in a box.
  await page.context().clearPermissions();
  await panel.getByRole("button", { name: "내 GPT로 그리기" }).click();
  const mine = page.getByRole("list", { name: "내 GPT로 그리기" });
  await mine.getByRole("button", { name: "그림 설명 복사" }).click();
  await expect(panel.getByLabel("그림 설명")).toHaveValue(/Scene: 밤 11시 사무실, 서윤이 모니터 앞에서 웃는다/);
  await expect(mine.getByRole("button", { name: "그린 그림 붙여 넣기" })).toBeVisible();
  await expect(page.locator(".yp-card-issues")).toContainText("1장 그림이 아직 없어요");
  // 말풍선 꼬리 맞추기 (1화 시안): once the 칸 has its picture, a tap on the preview says where the speaker is.
  await expect(page.getByRole("button", { name: "말풍선 꼬리 맞추기" })).toHaveCount(0);
  await panel.getByRole("button", { name: "그리기", exact: true }).click();
  await page.locator("dialog.cost-dlg").getByRole("button", { name: "그리기", exact: true }).click();
  await expect(page.locator(".yp-card-big img")).toBeVisible();
  await page.getByRole("button", { name: "말풍선 꼬리 맞추기" }).click();
  await page.locator(".yp-card-big").click({ position: { x: 60, y: 90 } });
  await expect(page.getByRole("button", { name: "꼬리 처음대로" })).toBeVisible();
  await expect(page.getByRole("button", { name: "말풍선 꼬리 맞추기" })).toHaveAttribute("aria-pressed", "false");
  // ⌘V of the picture copied from ChatGPT puts it on the card.
  const before = await page.locator(".yp-card-big img").getAttribute("src");
  await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 40, height: 50 });
    canvas.getContext("2d")!.fillRect(0, 0, 40, 50);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), "image/png"));
    const data = new DataTransfer(); data.items.add(new File([blob], "gpt.png", { type: "image/png" }));
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }));
  });
  await expect(page.locator(".yp-card-big img")).not.toHaveAttribute("src", before ?? "");
  await expect(page.getByRole("status").filter({ hasText: "✓ 2장에 넣었어요" })).toBeVisible();
  // A file dragged over the page lights it up with where it will land, and dropping it anywhere puts it on the card.
  const second = await page.locator(".yp-card-big img").getAttribute("src");
  const drag = async (type: string) => page.evaluate(async kind => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 40, height: 50 });
    canvas.getContext("2d")!.fillRect(0, 0, 20, 50);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), "image/png"));
    const data = new DataTransfer(); data.items.add(new File([blob], "gpt.png", { type: "image/png" }));
    document.body.dispatchEvent(new DragEvent(kind, { dataTransfer: data, bubbles: true, cancelable: true }));
  }, type);
  await drag("dragover");
  await expect(page.locator(".yp-card-drop")).toHaveText("여기에 놓으면 2장에 들어가요");
  await drag("drop");
  await expect(page.locator(".yp-card-drop")).toHaveCount(0);
  await expect(page.locator(".yp-card-big img")).not.toHaveAttribute("src", second ?? "");
  // 연재 (대표 2026-11-04): the story is not held to 10 cards and 「다음 화 나누기」 starts 2화 after the last 칸.
  await page.getByRole("button", { name: "다음 화 나누기" }).click();
  await expect(page.locator(".yp-card-tools b")).toHaveText("카드 9 / 100장 · 2화");
  await expect(page.getByRole("button", { name: "7장 보기", exact: true })).toContainText("2화 표지");
  await expect(page.locator(".yp-card-issues")).toContainText("2화에 칸이 없어요");
});

// 그림 한꺼번에 (대표 2026-11-04): the 웹툰 cards still to draw are ticked; 내 GPT pictures come back (since 2026-11-08 as one ZIP, each
// going to the card its file name says), the company API draws the ticked ones.
test("웹툰 pictures are drawn together: put back from one ZIP, or drawn on the API in one go", async ({ page }) => {
  await editor(page);
  await page.getByRole("checkbox", { name: "웹툰형", exact: true }).check();
  await page.getByRole("button", { name: "직접 쓰기", exact: true }).click();
  const row = page.locator(".yp-card-row", { has: page.locator(".yp-card-row-h b", { hasText: "웹툰형" }) });
  await row.getByRole("button", { name: "이 초안으로 다듬기", exact: true }).click();
  for (const [n, scene] of [[2, "밤 사무실, 서윤이 웃는다"], [3, "아침 사무실, 서윤이 놀란다"]] as const) {
    await page.getByRole("button", { name: `${n}장 보기`, exact: true }).click();
    await page.getByLabel("장면 (그릴 것)", { exact: true }).fill(scene);
  }
  await page.getByRole("button", { name: "그림 한꺼번에" }).click();
  const batch = page.getByRole("group", { name: "그림 한꺼번에" });
  await expect(batch.getByRole("checkbox", { name: "2장 고르기" })).toBeChecked();
  await expect(batch.getByRole("button", { name: "회사 API로 2장 그리기" })).toBeEnabled();
  await page.context().clearPermissions();
  await batch.getByRole("button", { name: "내 GPT로 한꺼번에" }).click();
  await batch.getByRole("button", { name: "그림 설명 복사 (2장)" }).click();
  await expect(batch.getByLabel("한꺼번에 그림 설명")).toHaveValue(/Picture 1 — 「2장」 · card-02\.png[\s\S]*Picture 2 — 「3장」 · card-03\.png/);
  await expect(batch.getByLabel("한꺼번에 그림 설명")).toHaveValue(/one ZIP file with all 2 PNGs/);
  // The ZIP holds card-03.png before card-02.png in a folder, plus a prompt text and a macOS copy that stay out.
  await batch.getByLabel("받은 ZIP · 그림 파일").setInputFiles("tests/fixtures/my-gpt-pictures.zip");
  await expect(batch.getByText("✓ 넣었어요")).toHaveCount(2);
  const before = await page.getByRole("button", { name: "2장 보기", exact: true }).locator("img").getAttribute("src");
  await batch.getByRole("checkbox", { name: "2장 고르기" }).check();
  await batch.getByRole("button", { name: "회사 API로 1장 그리기" }).click();
  await page.locator("dialog.cost-dlg").getByRole("button", { name: "1장 그리기", exact: true }).click();
  await expect(page.getByRole("button", { name: "2장 보기", exact: true }).locator("img")).toHaveAttribute("src", before!);
  await batch.getByRole("button", { name: "2장 그림 적용" }).click();
  await expect(page.getByRole("button", { name: "2장 보기", exact: true }).locator("img")).not.toHaveAttribute("src", before ?? "");
});

test("the three diagram formats can be started by hand", async ({ page }) => {
  await editor(page);
  for (const name of ["비교형", "단계형", "구조형"]) await page.getByRole("checkbox", { name, exact: true }).check();
  await page.getByRole("button", { name: "직접 쓰기", exact: true }).click();
  for (const name of ["비교형", "단계형", "구조형"]) await expect(page.locator(".yp-card-row-h b", { hasText: name })).toHaveCount(1);
});

test("headline and subcopy retain Enter and shared post text survives card selection and save", async ({ page }) => {
  await editor(page);
  await page.getByLabel("헤드 카피", { exact: true }).fill("QA 첫 줄\n둘째 줄");
  await page.getByLabel("서브", { exact: true }).fill("QA 서브\n둘째 줄");
  await expect(page.locator(".yp-card-big [data-card-field=head]")).toHaveCSS("white-space", "pre-wrap");
  await expect(page.locator(".yp-card-big [data-card-field=head]")).toHaveText("QA 첫 줄\n둘째 줄");
  const caption = page.getByLabel("공통 캡션");
  const tags = page.getByLabel("공통 해시태그");
  await caption.fill("QA 모든 카드의 공통 캡션");
  await tags.fill("#"); await tags.pressSequentially("커리어고민 #직장인 #강점");
  await expect(tags).toHaveValue("#커리어고민 #직장인 #강점");
  await tags.dispatchEvent("compositionstart");
  await tags.fill("#커리어고민 #직장인 #강점ㄱ");
  await page.waitForTimeout(1400);
  await expect(page.getByText("변경 내용 저장 대기", { exact: true })).toBeVisible();
  await tags.fill("#커리어고민 #직장인 #강점");
  await tags.dispatchEvent("compositionend");
  await page.getByRole("button", { name: "2장 보기", exact: true }).click();
  await expect(caption).toHaveValue("QA 모든 카드의 공통 캡션");
  await expect(tags).toHaveValue("#커리어고민 #직장인 #강점");
  await page.getByRole("button", { name: "1장 보기", exact: true }).click();
  await expect(page.getByLabel("헤드 카피", { exact: true })).toHaveValue("QA 첫 줄\n둘째 줄");
  await expect(page.getByText("저장됨", { exact: true })).toBeVisible();
  await expect(page.locator(".yp-card-flow .yp-fs .yp-d")).toHaveText(["1", "2", "3", "4"]);
});

test("cards add, remove, reorder, drag and undo without moving cover or ending", async ({ page }) => {
  await editor(page);
  await page.getByRole("button", { name: "2장 보기", exact: true }).click();
  await page.getByLabel("소제목", { exact: true }).fill("QA 첫째");
  await page.getByRole("button", { name: "3장 보기", exact: true }).click();
  await page.getByLabel("소제목", { exact: true }).fill("QA 둘째");
  await page.getByRole("button", { name: "2장 아래로", exact: true }).click();
  await expect(page.getByLabel("소제목", { exact: true })).toHaveValue("QA 첫째");
  await expect(page.getByRole("button", { name: "3장 보기", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "1장 아래로", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "1장 삭제", exact: true })).toBeDisabled();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.locator(".yp-card-item").nth(2).dispatchEvent("dragstart", { dataTransfer: transfer });
  await page.locator(".yp-card-item").nth(1).dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("button", { name: "2장 보기", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("소제목", { exact: true })).toHaveValue("QA 첫째");
  await page.getByRole("button", { name: "항목 카드 추가", exact: true }).click();
  await expect(page.locator(".yp-card-item")).toHaveCount(7);
  await page.getByRole("button", { name: "5장 삭제", exact: true }).click();
  await expect(page.locator(".yp-card-item")).toHaveCount(6);
  await page.getByRole("button", { name: "장 편집 되돌리기", exact: true }).click();
  await expect(page.locator(".yp-card-item")).toHaveCount(7);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "항목 카드 추가", exact: true }).click();
  await expect(page.locator(".yp-card-item")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "항목 카드 추가", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "10장 위로", exact: true })).toBeDisabled();
});

test("previous topic copies content but preserves the current assignee and owner spacing", async ({ page }) => {
  await page.goto("/content/plan?project=new&view=topic");
  await page.getByLabel("했던 주제 검색").fill("사업계획서");
  await page.getByRole("button", { name: /사업계획서.*주제 불러오기/ }).click();
  await expect(page).toHaveURL(/project=demo-.+&view=topic/);
  await expect(page.getByLabel("주제", { exact: true })).toHaveValue("[예시] 처음 쓰는 사업계획서의 순서");
  await expect(page.locator("#yp-topic-pd")).toHaveValue("demo-ricky");
  await expect(page.locator("#yp-topic-target")).not.toHaveValue("");
  const owner = await page.locator(".yp-topic-owner").boundingBox();
  const first = await page.locator(".yp-fsec").first().boundingBox();
  expect(first!.y - (owner!.y + owner!.height)).toBeGreaterThanOrEqual(16);
});

async function exportCard(page: Page) {
  await editor(page);
  for (const [index, fields] of [[1, { "헤드 카피": "QA 표지", "서브": "QA 서브" }], [2, { "소제목": "QA 하나", "설명": "QA 첫 설명" }], [3, { "소제목": "QA 둘", "설명": "QA 둘째 설명" }], [4, { "소제목": "QA 셋", "설명": "QA 셋째 설명" }], [5, { "한 줄 정리": "QA 정리" }], [6, { "마무리 문장": "QA 마무리", "다음 행동": "저장해요" }]] as [number, Record<string, string>][]) {
    await page.getByRole("button", { name: `${index}장 보기`, exact: true }).click();
    for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel("공통 캡션").fill("QA 공통 게시글");
  await page.getByLabel("공통 해시태그").fill("#테스트 #카드 #작업");
  await page.locator(".yp-fl-act button.yp-pri").click();
  await expect(page).toHaveURL(/\/content\/final-check/);
  await expect(page.locator(".yp-card-caption")).toHaveText("QA 공통 게시글");
  // 화면 자동 검사 (설계서 §4-3) sits under the cards; the practice screen never calls GPT.
  await expect(page.getByText("아직 검사하지 않았어요")).toBeVisible();
  await page.getByRole("button", { name: "검사하기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "연습 화면에서는 GPT를 부르지 않아요." })).toBeVisible();
  await page.locator(".yp-fl-act button.yp-pri").click();
  await expect(page).toHaveURL(/\/content\/upload/);
  await expect(page.getByLabel("올린 주소", { exact: true })).toBeVisible();
}

test("closing without a publication requires a saved reason and keeps the card outside published totals", async ({ page }) => {
  await exportCard(page);
  await expect(page.getByRole("button", { name: "다 올렸으면 끝내기", exact: true })).toBeDisabled();
  await page.getByLabel("올린 주소", { exact: true }).fill("https://www.instagram.com/");
  await expect(page.getByRole("button", { name: "주소 남기기", exact: true })).toBeDisabled();
  await page.getByLabel("올린 주소", { exact: true }).fill("");
  await page.getByText("남은 화 게시 안 함", { exact: true }).click();
  await page.getByLabel("게시 안 함 이유").fill("게시 일정 보류");
  await page.getByRole("button", { name: "이유 저장" }).click();
  await page.getByRole("button", { name: "게시 안 함으로 마치기", exact: true }).click();
  await expect(page.locator(".yp-fl-status")).toContainText("게시 안 함");
  await expect(page.getByText("게시 안 함 · 게시 일정 보류", { exact: true })).toBeVisible();
  await page.locator(".yp-fl-proj").click();
  await page.getByRole("link", { name: "주제 찾기", exact: true }).last().click();
  await page.getByRole("tab", { name: "카드뉴스", exact: false }).first().click();
  await expect(page.getByRole("tab", { name: /완료된 카드뉴스/ })).toContainText("0");
});

test("URL bookmarks persist per account, load without posting, undo removal and completed cards reopen", async ({ page }) => {
  await exportCard(page);
  const address = page.getByLabel("올린 주소", { exact: true });
  await address.fill("https://www.instagram.com/p/qa-card/");
  await page.getByText("자주 쓰는 주소", { exact: true }).click();
  await page.getByLabel("주소 즐겨찾기 이름").fill("QA 게시물");
  await page.getByRole("button", { name: "현재 주소 즐겨찾기", exact: true }).click();
  await expect(page.getByLabel("저장한 주소").locator("option")).toContainText(["즐겨찾기 선택", "QA 게시물"]);
  await address.fill("https://www.instagram.com/p/other/");
  await page.getByRole("button", { name: "주소 불러오기", exact: true }).click();
  await expect(address).toHaveValue("https://www.instagram.com/p/qa-card/");
  await expect(page.getByRole("button", { name: "주소 남기기", exact: true })).toBeEnabled();
  await expect(page.getByText(/^남김 ·/)).toHaveCount(0);
  await page.getByRole("button", { name: "즐겨찾기 삭제", exact: true }).click();
  await page.getByRole("button", { name: "즐겨찾기 삭제 되돌리기", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("brandy:card-url-bookmarks:v1:demo-ricky")!)[0].url)).toBe("https://www.instagram.com/p/qa-card/");
  await page.getByRole("button", { name: "주소 남기기", exact: true }).click();
  await expect(page.getByText(/^남김 ·/)).toBeVisible();
  await page.getByRole("button", { name: "다 올렸으면 끝내기", exact: true }).click();
  await expect(page.locator(".yp-fl-status")).toContainText("끝난 카드뉴스");
  await page.locator(".yp-fl-proj").click();
  await page.getByRole("link", { name: "주제 찾기", exact: true }).last().click();
  await page.getByRole("tablist", { name: "무엇을 만드나요" }).getByRole("tab", { name: /카드뉴스/ }).click();
  await page.getByRole("tab", { name: /완료된 카드뉴스/ }).click();
  await expect(page.locator(".yp-card-catalog li")).toHaveCount(1);
  await page.locator(".yp-card-catalog").getByRole("link", { name: "열기", exact: true }).click();
  await expect(page.getByLabel("저장한 주소").locator("option")).toContainText(["즐겨찾기 선택", "QA 게시물"]);
  await expect(address).toHaveValue("https://www.instagram.com/p/qa-card/");
});

for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
  test(`card screens stay within ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    for (const [name, url] of [["catalog", startUrl], ["editor", editUrl]]) {
      await page.goto(url);
      await expect(page.locator("section.yp.ui-v2")).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`${name}-${width}-${theme}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test("card catalog and cover reads reject unauthenticated callers before validation", async ({ request }) => {
  for (const url of ["/api/v1/content/youtube/cards", "/api/v1/content/youtube/cards?covers=not-a-uuid", "/api/v1/content/youtube/card-characters"]) {
    const response = await request.get(url); expect(response.status()).toBe(401);
  }
  // 카드 그림 and 캐릭터 창고 writes ask for a session too, before anything is read or drawn.
  expect((await request.post("/api/v1/content/youtube/projects/00000000-0000-4000-8000-000000000000/cards", { data: { action: "draw", scene: "QA", style: "simple", quality: "medium", refs: [] } })).status()).toBe(401);
  expect((await request.delete("/api/v1/content/youtube/card-characters?id=00000000-0000-4000-8000-000000000000")).status()).toBe(401);
});

test("project platform selector filters every kind, retains search and can leave an empty status", async ({ page }) => {
  await page.goto("/content/projects");
  const platform = page.getByLabel("영상 플랫폼");
  for (const [value, label] of [["card", "카드뉴스"], ["ad", "광고"], ["short", "숏폼 · 릴스"], ["longform", "롱폼"]]) {
    await platform.selectOption(value);
    await expect(page).toHaveURL(new RegExp(`platform=${value}`));
    if (value === "card") {
      const cards = page.locator(".yp-library-list .yp-mv");
      await expect(cards).toHaveCount(1);
      await expect(cards.getByRole("link", { name: /카드 만들기/ })).toHaveAttribute("href", /project=demo-p13/);
      await expect(cards.locator(".yp-library-format")).toHaveText(/정리형/);
    } else {
      await expect.poll(async () => {
        const tags = await page.locator(".yp-mv-list .yp-pf-tag").allTextContents();
        return tags.length > 0 && tags.every(tag => tag === label);
      }).toBe(true);
    }
  }
  await page.getByLabel("영상 검색").fill("QA 없는 주제");
  await platform.selectOption("card");
  await expect(page.getByLabel("카드뉴스 검색")).toHaveValue("QA 없는 주제");
  await expect(page.getByText("찾는 카드뉴스가 없어요", { exact: true })).toBeVisible();
  await page.getByLabel("카드뉴스 검색").fill("");
  await page.getByRole("tab", { name: /^끝난 카드뉴스/ }).click();
  await expect(page.getByText("아직 끝난 카드뉴스가 없어요", { exact: true })).toBeVisible();
  await expect(platform).toBeVisible();
  await platform.selectOption("longform");
  await expect(page.locator(".yp-mv-list .yp-pf-tag")).toHaveText(["롱폼"]);
  await page.reload();
  await expect(platform).toHaveValue("longform");
  await platform.selectOption("all");
  await expect(page).not.toHaveURL(/platform=/);
});

for (const width of [1732, 1440, 390]) for (const theme of ["light", "dark"]) {
  test(`platform and status layout aligns at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
    await page.goto(startUrl);
    for (const tab of await page.locator(".yp-pf").all()) await expect(tab).toHaveCSS("border-radius", "0px");
    await expect(page.locator(".yp-pf-bar")).toHaveCSS("border-radius", "0px");
    const colors = await page.locator(".yp-pf-tabs .yp-pf").evaluateAll(tabs => Object.fromEntries(tabs.flatMap(tab => { const kind = [...tab.classList].find(name => /^yp-pf-(longform|short|ad|card)$/.test(name)); return kind ? [[kind, getComputedStyle(tab).color]] : []; })));
    const status = page.getByRole("tablist", { name: "카드뉴스 상태" });
    const panel = page.getByRole("tabpanel");
    const bar = await status.boundingBox(), body = await panel.boundingBox();
    expect(Math.abs(bar!.x - body!.x)).toBeLessThan(1);
    expect(Math.abs(bar!.width - body!.width)).toBeLessThan(1);
    await status.getByRole("tab", { name: /만드는 중/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(status.getByRole("tab", { name: /완료된/ })).toBeFocused();
    await expect(status.getByRole("tab", { name: /완료된/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(status.getByRole("tab", { name: /만드는 중/ })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: info.outputPath(`catalog-${width}-${theme}.png`), fullPage: true });
    await page.goto("/content/projects?view=discover");
    const left = (await page.locator(".yp-pf-tabs").boundingBox())!.x;
    for (const selector of [".yp-pf-bar", ".yp-disc-tabs", ".yp-disc-search", ".yp-chips", ".yp-ref-grid"]) expect(Math.abs((await page.locator(selector).boundingBox())!.x - left)).toBeLessThan(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`discover-${width}-${theme}.png`), fullPage: true });
    await page.goto("/content/projects");
    await expect(page.locator(".yp-mv-list .yp-pf-tag").first()).toBeVisible();
    for (const [kind, color] of Object.entries(colors)) await expect(page.locator(`.yp-pf-tag.${kind}`).first()).toHaveCSS("background-color", color);
    const contrast = await page.locator(".yp-pf-tag").evaluateAll(tags => tags.map(tag => {
      const style = getComputedStyle(tag);
      const luminance = (value: string) => { const rgb = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
      const front = luminance(style.color), back = luminance(style.backgroundColor);
      return (Math.max(front, back) + .05) / (Math.min(front, back) + .05);
    }));
    expect(contrast.every(ratio => ratio >= 4.5)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`projects-${width}-${theme}.png`), fullPage: true });
  });
}

test("same-topic planning comparison and single-slide rewrite preserve the baseline", async ({ page }) => {
  await editor(page);
  const rows = page.locator(".yp-card-row");
  const original = await rows.first().locator("[data-card-field=head]").textContent();
  await page.getByRole("button", { name: "같은 주제로 개선 예시 비교" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "기획 확인 · 로컬 예시 열기" }).click();
  await expect(rows).toHaveCount(2);
  const cover = rows.nth(1).locator("[data-card-field=head]");
  await expect(cover).toContainText("일요일 밤");
  await rows.nth(1).getByRole("button", { name: "이 초안으로 다듬기" }).click();
  await page.getByRole("button", { name: "2장 보기", exact: true }).click();
  await page.getByText("부분 수정 · 재생성", { exact: true }).click();
  await page.getByLabel("수정 범위").selectOption("page");
  await page.getByRole("button", { name: "2장만 다시 만들기" }).click();
  await expect(rows.nth(1)).not.toContainText("걱정에 이름 붙이기");
  await page.getByRole("button", { name: "완료한 수정안 적용" }).click();
  await expect(rows.nth(1)).toContainText("걱정에 이름 붙이기");
  await expect(cover).toContainText("일요일 밤");
  await expect(rows.first().locator("[data-card-field=head]")).toHaveText(original!);
  await page.getByLabel("문구 잠금", { exact: true }).check();
  if (!await page.getByLabel("수정 범위").isVisible()) await page.getByText("부분 수정 · 재생성", { exact: true }).click();
  await page.getByLabel("수정 범위").selectOption("all");
  await page.getByRole("button", { name: "전체 페이지 다시 만들기" }).click();
  const candidates = page.locator("details").filter({ has: page.locator("summary", { hasText: "부분 수정 · 재생성" }) });
  await expect(candidates.getByText("1장 · 완료", { exact: true })).toBeVisible();
  await expect(candidates.getByText("2장 · 완료", { exact: true })).toHaveCount(0);
  await candidates.getByRole("button", { name: "취소", exact: true }).click();
  await expect(cover).toContainText("일요일 밤");

});

test("all seven format samples are available before generation", async ({ page }) => {
  await editor(page);
  const sample = page.getByRole("region", { name: "포맷 결과 예시" });
  for (const format of ["list", "myth", "quote", "compare", "steps", "structure", "webtoon"]) {
    await sample.getByRole("combobox").selectOption(format);
    await expect(sample.locator(".yp-card-pv")).toBeVisible();
    await expect(sample.getByRole("combobox")).toHaveValue(format);
  }
});

test("a saved plan restores its format after reload without starting GPT", async ({ page }) => {
  await page.goto(editUrl);
  const section = page.locator(".yp-fsec").filter({ has: page.getByText("포맷 고르기", { exact: true }) });
  const formats = section.getByRole("checkbox");
  await expect(formats.first()).toBeVisible();
  for (const format of await formats.all()) await format.uncheck();
  await section.getByRole("checkbox", { name: "단계형" }).check();
  await section.getByRole("button", { name: "기획안 확인", exact: true }).click();
  await section.getByRole("textbox").fill("영수증을 보관하고 정산할 때 찾는 세 단계");
  await section.getByRole("button", { name: "기획안 저장", exact: true }).click();
  await expect(section.getByText("기획안과 선택한 포맷을 저장했어요.")).toBeVisible();
  await page.reload();
  await expect(section.locator("input:checked")).toHaveCount(1);
  await expect(section.getByRole("checkbox", { name: "단계형" })).toBeChecked();
  await section.getByRole("button", { name: "기획안 확인", exact: true }).click();
  await expect(section.getByRole("textbox")).toHaveValue("영수증을 보관하고 정산할 때 찾는 세 단계");
  await expect(section.getByRole("button", { name: "직접 쓰기" })).toBeEnabled();
});

test("the list starts a card in place and persists edited title, audience and test visibility", async ({ page }) => {
  const list = "/content/projects?platform=card";
  await page.goto(list);
  await page.getByRole("button", { name: "새 카드뉴스", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "새 카드뉴스" });
  await expect(sheet.getByRole("region", { name: "완료한 주제 가져오기" })).toBeVisible();
  await sheet.getByRole("button", { name: "새 주제로" }).click();
  await sheet.getByLabel("한 줄 주제").fill("월요일 아침의 작은 계획");
  await sheet.getByLabel("누구에게").fill("주말에도 걱정하는 직장인");
  await sheet.getByRole("button", { name: /카드 만들러 가기/ }).click();
  await expect(page.getByRole("button", { name: "기획안 확인", exact: true })).toBeVisible();
  await page.locator(".yp-subj").getByRole("button", { name: "더 보기" }).click();
  const details = page.locator(".yp-more form");
  await details.getByLabel("제목").fill("월요일 오전에 시작할 일");
  await details.getByLabel("대상").fill("첫 회의를 준비하는 팀장");
  await details.getByLabel("시험").check();
  await details.getByRole("button", { name: "카드 정보 저장" }).click();
  await expect(page.locator(".yp-subj-t")).toHaveText("월요일 오전에 시작할 일");
  await page.locator(".yp-fl-proj").click();
  await expect(page).toHaveURL(/platform=card/);
  await expect(page.locator(".yp-mv-list")).not.toContainText("월요일 오전에 시작할 일");
  await page.getByLabel("시험·복사본 포함").check();
  const row = page.locator(".yp-mv-list .yp-mv").filter({ hasText: "월요일 오전에 시작할 일" });
  await row.getByRole("link", { name: /카드 만들기/ }).click();
  await page.locator(".yp-subj").getByRole("button", { name: "더 보기" }).click();
  await expect(details.getByLabel("대상")).toHaveValue("첫 회의를 준비하는 팀장");
  await expect(details.getByLabel("시험")).toBeChecked();
});

test("an editorial term blocks confirmation and the issue opens the exact slide field", async ({ page }) => {
  await editor(page);
  await page.getByRole("button", { name: "3장 보기", exact: true }).click();
  const field = page.getByLabel("소제목", { exact: true });
  await field.fill("제공된 원고");
  await page.getByRole("button", { name: "1장 보기", exact: true }).click();
  await page.locator(".yp-card-issues").getByRole("button", { name: /3장 소제목 · 제작 용어/ }).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("제공된 원고");
  await expect(page.locator(".yp-fl-act button.yp-pri")).toBeDisabled();
});

test("mobile export offers the next task and does not mark a failed download as complete", async ({ page }) => {
  await exportCard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const top = page.locator(".yp-fl-act");
  await page.reload();
  await expect(page.getByText(/연습 화면에서는 카드 미리보기만 제공합니다/)).toBeVisible();
  await expect(page.getByRole("button", { name: "이미지 묶음 내려받기" })).toBeDisabled();
  await expect(top.getByRole("button", { name: "이미지 내려받기", exact: true })).toHaveCount(0);
  await page.getByText("남은 화 게시 안 함", { exact: true }).click();
  await page.getByLabel("게시 안 함 이유").fill("검토중");
  await expect(page.getByRole("button", { name: "이유 저장" })).toBeDisabled();
});

test("production inputs reopen, create the selected outline and keep image work behind review", async ({ page }) => {
  await editor(page);
  const form = page.getByRole("region", { name: "유형별 카드 제작" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => form.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await form.getByRole("button", { name: /설명형/ }).click();
  await form.getByRole("button", { name: /단계형/ }).click();
  await form.getByLabel("작업명").fill("회의 메모");
  await form.getByLabel("원문·메모").fill("질문을 적어요.\n담당자를 정해요.\n기한을 적어요.");
  await form.getByLabel("실행 순서").fill("질문\n담당자\n기한");
  await expect(form.getByRole("status")).toHaveText("저장 완료");
  await page.reload();
  await expect(form.getByLabel("실행 순서")).toHaveValue("질문\n담당자\n기한");
  await form.getByRole("button", { name: "페이지 구성 만들기" }).click();
  const make = page.getByRole("button", { name: "이 구성으로 제작하기" });
  await expect(make).toBeVisible();
  await expect(make).toBeDisabled();
  await expect(page.getByRole("button", { name: "AI로 그리기" })).toHaveCount(0);
  await page.getByRole("button", { name: "5장 보기", exact: true }).click();
  await page.getByRole("textbox", { name: "한 줄 정리", exact: true }).fill("회의에서 정한 일을 기록해요");
  await page.getByRole("button", { name: "6장 보기", exact: true }).click();
  await page.getByRole("textbox", { name: "마무리 문장", exact: true }).fill("다음 회의에서 써 보세요");
  await page.getByRole("textbox", { name: "다음 행동", exact: true }).fill("한 줄 적기");
  await make.click();
  await expect(make).toHaveCount(0);
  await page.getByRole("button", { name: "전체 미리보기", exact: true }).click();
  await expect(page.locator('[aria-label="전체 페이지 미리보기"] .yp-card-pv')).toHaveCount(6);
  await page.getByRole("checkbox", { name: "문구 잠금" }).check();
  await expect(page.getByText("저장됨", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "6장 보기", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox", { name: "문구 잠금" })).toBeChecked();
});
