import { expect, test } from "@playwright/test";

test.beforeEach(() => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "최종 검토 requires the YouTube process v1 flag.");
});

// 개발 요청 8cb3c12e: 영상 피드백 — 표시(N04·N05), 첨부(N06), @멘션(N03), 반영·확인(R03), 답글·수정·삭제(R02·R04), 검색·필터(N01·N02).
test("video feedback: marks, attachment, resolve and confirm, reply, edit and delete, search and filter, open from a notice", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept());
  await page.goto("/content/projects");
  const row = page.locator(".yp-mv").filter({ hasText: "최종 검토" }).first();
  await row.locator("a.yp-btn").click();
  await expect(page).toHaveURL(/\/content\/final-check\?project=/);
  const projectUrl = page.url();

  // N04·N05: a rectangle and a pin on the frame.
  const tools = page.getByRole("group", { name: "화면에 표시하기" });
  await tools.getByRole("button", { name: /사각형/ }).click();
  const layer = page.locator(".yp-marks.yp-drawing");
  const box = (await layer.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 4 });
  await page.mouse.up();
  await tools.getByRole("button", { name: /핀/ }).click();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3);
  await expect(tools.getByRole("button", { name: /지우기 2/ })).toBeVisible();

  // N06: one reference image.
  await page.locator(".yp-comp-f input[type=file]").setInputFiles({ name: "참고-장면.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5e5c2a20000000049454e44ae426082", "hex") });
  await expect(page.locator(".yp-comp .yp-files")).toContainText("참고-장면.png");
  await page.getByLabel("피드백", { exact: true }).fill("@로건 사각형 안 글자가 잘려요. 핀 위치로 옮겨 주세요.");
  await page.locator(".yp-comp-f").getByRole("button", { name: "남기기" }).click();
  const item = page.locator(".yp-fi").filter({ hasText: "사각형 안 글자가 잘려요" });
  await expect(item).toContainText("표시 2");
  const id = (await item.getAttribute("id"))!.replace(/^fb-/, "");

  // R03: ✓ 반영, then the requester confirms.
  await item.getByRole("checkbox", { name: "반영" }).click();  // the item moves to the folded 반영됨 list
  await page.getByRole("button", { name: /반영됨 \d+개/ }).click();
  await item.getByRole("button", { name: "펼치기" }).click();
  await expect(item).toContainText("요청자 확인 전");
  await expect(item.getByRole("button", { name: "참고-장면.png" })).toBeVisible();
  await item.getByRole("button", { name: "반영 확인" }).click();
  await expect(item).toContainText("요청자 확인 완료");

  // R02·R04: a reply after resolve, edited, then the item deleted with the thread kept.
  await item.getByRole("button", { name: /답글/ }).first().click();
  await item.getByLabel("답글", { exact: true }).fill("확인했어요. 전환만 0.5초 늦춰 주세요.");
  await item.getByRole("button", { name: "남기기" }).click();
  await expect(item.locator(".yp-rep")).toContainText("전환만 0.5초");
  await item.locator(".yp-rep").getByRole("button", { name: "수정" }).click();
  await item.getByLabel("고칠 내용").fill("전환만 1초 늦춰 주세요.");
  await item.getByRole("button", { name: "고치기" }).click();
  await expect(item.locator(".yp-rep")).toContainText("전환만 1초 늦춰 주세요. · ");

  // N01·N02: search and status filter.
  await page.getByLabel("피드백 찾기").fill("1초 늦춰");
  await expect(page.locator(".yp-fbl .yp-fi")).toHaveCount(1);
  await page.getByRole("group", { name: "상태" }).getByRole("button", { name: "미반영" }).click();
  await expect(page.locator(".yp-fbl")).toContainText("맞는 피드백이 없어요");
  await page.getByRole("group", { name: "상태" }).getByRole("button", { name: "반영됨" }).click();
  await expect(page.locator(".yp-fbl .yp-fi")).toHaveCount(1);
  await page.getByRole("group", { name: "상태" }).getByRole("button", { name: "전체" }).click();
  await page.getByLabel("피드백 찾기").fill("");

  await item.locator(".yp-fi-a").getByRole("button", { name: /삭제/ }).click();
  const byId = page.locator(`#fb-${id}`);  // its text is gone now, so find it by id
  await expect(byId.locator(".yp-tx")).toHaveText("삭제된 댓글입니다");
  await expect(byId.locator(".yp-rep")).toContainText("전환만 1초");

  // N03: a notice link opens that item (in-app navigation; a reload would reset the demo data).
  await byId.getByRole("button", { name: "펼치기" }).click();
  await expect(byId).not.toHaveClass(/yp-open/);
  await page.evaluate(url => window.history.pushState(null, "", url), `${new URL(projectUrl).pathname}${new URL(projectUrl).search}&feedback=${id}`);
  await expect(byId).toHaveClass(/yp-open/);
  expect(errors).toEqual([]);
});

// N07: two versions side by side, B following A with a time offset, and feedback on an earlier version.
test("video feedback: compare two versions and leave feedback on the earlier one", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/content/projects");
  await page.locator(".yp-mv").filter({ hasText: "최종 검토" }).first().locator("a.yp-btn").click();
  await expect(page).toHaveURL(/\/content\/final-check\?project=/);
  const projectId = new URL(page.url()).searchParams.get("project")!;
  await page.getByRole("link", { name: /제작에서 새 버전 올리기/ }).click();
  await expect(page).toHaveURL(/\/content\/make\?project=/);
  const input = page.locator('input[type=file][accept^="video/mp4"]').last();
  for (const name of ["v1.webm", "v2.webm"]) {
    await input.setInputFiles({ name, mimeType: "video/webm", buffer: Buffer.from("1a45dfa3", "hex") });
    await expect(page.getByText(name).first()).toBeVisible();
  }
  await page.getByRole("link", { name: /이어서 하기 · 최종 검토/ }).first().click();  // in-app, so the demo uploads stay
  await expect(page).toHaveURL(new RegExp(`/content/final-check\\?project=${projectId}`));
  await page.getByRole("button", { name: /버전 비교/ }).click();
  await expect(page.locator(".yp-compare .yp-cside")).toBeVisible();
  await page.getByLabel("B 시간 보정(초)").fill("2");
  await expect(page.locator(".yp-clabel")).toContainText("+2초");
  await page.getByLabel("영상 버전").selectOption({ index: 1 });
  await expect(page.locator(".yp-comp")).toContainText("이전 버전");
  await page.getByLabel("피드백", { exact: true }).fill("이전 버전 이 장면이 더 나았어요");
  await page.locator(".yp-comp-f").getByRole("button", { name: "남기기" }).click();
  await expect(page.locator(".yp-fi").filter({ hasText: "이전 버전 이 장면이 더 나았어요" })).toBeVisible();
  await page.getByRole("button", { name: "비교 끄기" }).click();
  await expect(page.locator(".yp-compare")).toHaveCount(0);
  expect(errors).toEqual([]);
});
