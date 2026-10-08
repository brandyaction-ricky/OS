import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("brandy-os-menu-guide-final", "seen");
    localStorage.setItem("brandy-knowledge-focus", "false");
  });
});

for (const theme of ["light", "dark"]) for (const width of [1440, 390]) {
  test(`account action rows are aligned at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
    await page.goto("/knowledge/search");
    if (width === 390) await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
    await page.getByRole("button", { name: "내 계정 메뉴", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "내 계정", exact: true });
    await expect(menu).toBeVisible();
    const metrics = await menu.locator(".profile-menu-action").evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      const text = element.querySelector("span")!.getBoundingClientRect();
      const icon = element.querySelector("svg")!.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { x: rect.x, width: rect.width, height: rect.height, textX: text.x, iconX: icon.x, iconWidth: icon.width, font: style.fontSize, line: style.lineHeight, margin: style.marginTop, border: style.borderTopWidth };
    }));
    expect(metrics.length).toBe(3); // Demo hides credential-changing actions; all use the same row class.
    for (const metric of metrics) expect(metric).toEqual(metrics[0]);
    expect(metrics[0]).toMatchObject({ height: 40, iconWidth: 15, font: "13px", line: "20px", margin: "0px", border: "0px" });
    const separators = await menu.locator(".profile-menu-actions > * + *").evaluateAll(elements => elements.map(element => getComputedStyle(element, "::before").borderTopWidth));
    expect(separators).toEqual(["1px", "1px"]);
    await page.screenshot({ path: testInfo.outputPath(`account-menu-${theme}-${width}.png`), mask: [menu.locator(":scope > strong, :scope > span"), page.locator(".profile-trigger")] });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: width === 390 ? "메뉴 열기" : "내 계정 메뉴", exact: true })).toBeFocused();
  });
}

async function dropFiles(page: Page, files: { name: string; type: string; size?: number }[]) {
  const data = await page.evaluateHandle(async descriptions => {
    const transfer = new DataTransfer();
    for (const file of descriptions) {
      const canvas = document.createElement("canvas"); canvas.width = 4; canvas.height = 4;
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), file.type === "image/jpeg" ? "image/jpeg" : "image/png"));
      transfer.items.add(new File([file.size === undefined ? blob : new Uint8Array(file.size)], file.name, { type: file.type }));
    }
    return transfer;
  }, files);
  const zone = page.getByRole("group", { name: "이미지 드래그앤드롭 첨부" });
  await zone.dispatchEvent("dragenter", { dataTransfer: data });
  await zone.dispatchEvent("dragover", { dataTransfer: data });
  await expect(zone).toHaveClass(/drag-active/);
  await zone.dispatchEvent("drop", { dataTransfer: data });
  await expect(zone).not.toHaveClass(/drag-active/);
  await data.dispose();
}

for (const width of [1440, 390]) test(`image drop validates and previews locally at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 960 });
  const writes: string[] = [];
  page.on("request", request => { if (request.method() !== "GET" && /development-attachments|development-requests|storage\/v1/.test(request.url())) writes.push(request.url()); });
  await page.goto("/knowledge/search");
  if (width === 390) await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "수정 요청 남기기", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "수정 요청", exact: true });
  const preview = drawer.getByRole("img", { name: "첨부할 이미지 미리보기" });
  await expect(drawer.getByLabel("프로젝트")).toHaveValue("demo-os");
  for (const type of ["image/png", "image/jpeg", ""]) {
    const name = type === "image/jpeg" ? "drop.jpg" : "drop.png";
    await dropFiles(page, [{ name, type }]);
    await expect(drawer.getByRole("status")).toContainText(name);
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  for (const [files, message] of [
    [[{ name: "notes.txt", type: "text/plain" }], "JPG·PNG 이미지만 지원"],
    [[{ name: "spoof.png", type: "text/plain" }], "JPG·PNG 이미지만 지원"],
    [[{ name: "one.png", type: "image/png" }, { name: "two.jpg", type: "image/jpeg" }], "한 번에 한 개씩"],
    [[{ name: "empty.png", type: "image/png", size: 0 }], "25MB 이하"],
    [[{ name: "large.png", type: "image/png", size: 26 * 1024 * 1024 }], "25MB 이하"],
  ] as const) {
    await dropFiles(page, [...files]);
    await expect(drawer.getByRole("alert")).toContainText(message);
    await expect(drawer.getByRole("status")).toContainText("drop.png");
    await expect(preview).toBeVisible();
  }
  await drawer.getByRole("button", { name: "첨부 해제", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await drawer.getByLabel("자료 첨부", { exact: true }).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("local fixture") });
  await expect(drawer.getByRole("status")).toContainText("notes.txt");
  await expect(drawer.getByRole("alert")).toHaveCount(0);
  await expect(preview).toHaveCount(0); // Existing non-image chooser remains supported.
  await drawer.getByRole("button", { name: "첨부 해제", exact: true }).click();
  await dropFiles(page, [{ name: "drop.png", type: "image/png" }]);
  await page.screenshot({ path: testInfo.outputPath(`image-drop-${width}.png`), mask: [page.locator(".profile-trigger")] });
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await drawer.getByLabel("제목", { exact: true }).fill("Local attachment check");
  await drawer.getByLabel("현재 문제", { exact: true }).fill("Synthetic local-only fixture");
  await drawer.getByRole("button", { name: "수정 요청 등록", exact: true }).click();
  await expect(drawer).toContainText("데모에서는 실제 요청을 저장하지 않습니다.");
  expect(writes).toEqual([]);
});

for (const width of [1440, 901, 900, 390]) test(`hidden file tree is bounded and does not overlap reading at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 960 });
  await page.addInitScript(() => localStorage.setItem("brandy-knowledge-tree", "false"));
  await page.goto("/knowledge?document=demo-packaging");
  const handle = page.getByRole("button", { name: "파일 트리 잠시 보기", exact: true });
  const tree = page.locator(".knowledge-tree-pane");
  await expect(page.getByRole("button", { name: "정본 편집", exact: true })).toBeVisible();
  if (width <= 900) {
    await expect(handle).toBeHidden();
    await page.getByRole("button", { name: "파일 트리 보기", exact: true }).click();
    await expect(tree).toBeVisible();
    await expect(tree).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await page.getByRole("button", { name: "트리 안에서 접기", exact: true }).click();
    await expect(tree).not.toHaveClass(/mobile-open/);
    await expect(tree).not.toBeInViewport(); // Mobile keeps the slide-out panel mounted off screen.
  } else {
    const bounds = await handle.boundingBox();
    const reader = await page.locator(".editor-pane").boundingBox();
    expect(bounds!.height).toBe(100);
    expect(bounds!.width).toBe(36);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(reader!.x);
    await page.screenshot({ path: testInfo.outputPath(`tree-collapsed-${width}.png`), mask: [page.locator(".profile-trigger")] });
    await handle.focus();
    await expect(tree).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tree).toBeHidden();
    await handle.hover();
    await expect(tree).toBeVisible();
    await handle.click();
    await expect(page.locator(".knowledge-workspace")).not.toHaveClass(/tree-hidden/);
    await expect(tree).toBeVisible();
    await page.getByRole("button", { name: "파일 트리 숨기기", exact: true }).click();
    await expect(tree).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`canonical confirmation fits its content and retains keyboard controls at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 960 });
  await page.goto("/knowledge?document=demo-packaging");
  const edit = page.getByRole("button", { name: "정본 편집", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "회사 정본 변경 제안", exact: true });
  await expect(dialog).toBeVisible();
  const outer = await dialog.boundingBox();
  const content = await dialog.locator(".canonical-gate-modal").boundingBox();
  expect(outer!.width).toBeLessThanOrEqual(480);
  expect(Math.abs(outer!.width - content!.width)).toBeLessThanOrEqual(1);
  expect(outer!.x).toBeGreaterThanOrEqual(10);
  expect(outer!.x + outer!.width).toBeLessThanOrEqual(width - 10);
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "변경 제안 작성", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath(`canonical-confirmation-${width}.png`), mask: [page.locator(".profile-trigger")] });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
});
