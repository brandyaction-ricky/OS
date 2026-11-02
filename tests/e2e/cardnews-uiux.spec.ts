import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Requires the isolated YouTube-process demo.");
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});
const startUrl = "/content/projects?view=discover&platform=card";
const editUrl = "/content/plan?project=demo-p13&view=draft";
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
  await expect(panel.locator(".cost-tag")).toContainText("원");
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

test("URL bookmarks persist per account, load without posting, undo removal and completed cards reopen", async ({ page }) => {
  await exportCard(page);
  const address = page.getByLabel("올린 주소", { exact: true });
  await address.fill("https://www.instagram.com/p/qa-card/");
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
  await page.getByRole("tab", { name: /카드뉴스/ }).click();
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
    await expect.poll(async () => { const tags = await page.locator(".yp-mv-list .yp-pf-tag").allTextContents(); return tags.length > 0 && tags.every(tag => tag === label); }).toBe(true);
  }
  await page.getByLabel("영상 검색").fill("QA 없는 주제");
  await platform.selectOption("card");
  await expect(page.getByLabel("영상 검색")).toHaveValue("QA 없는 주제");
  await expect(page.getByText("찾는 영상이 없어요", { exact: true })).toBeVisible();
  await page.getByLabel("영상 검색").fill("");
  await page.getByRole("tab", { name: /^끝난 영상/ }).click();
  await expect(page.getByText("아직 끝난 영상이 없어요", { exact: true })).toBeVisible();
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
