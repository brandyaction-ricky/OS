import { expect, test, type Page } from "@playwright/test";
import type { OsRecord } from "../../lib/record-types";

// Only fictional records and intercepted requests. No Meta, database or real post.
test.skip(process.env.REFERENCE_MOCK_E2E !== "true", "Requires the isolated local mock-auth server.");
const OWNER = "00000000-0000-4000-8000-000000000001";
const SHARED = "00000000-0000-4000-8000-000000000002";
const ITEM = "00000000-0000-4000-8000-000000000041";
const AT = "2026-01-15T03:00:00.000Z";
const POSTS = ["팀을 옮겼는데 같은 일이 더 어려워졌다.\n\n직무 이름은 같아도 실제 일하는 순서는 달랐다.", "새 팀이 일을 나누고 확인하는 방식부터 볼 수 있다.", "지난주 끝낸 일 하나만 다시 떠올려보자.\n\n어디에서 기다렸고, 누구에게 확인받았는지 적어보자."];
function fixture(): OsRecord {
  return { id: ITEM, title: "같은 일을 다른 팀에서 하면 무엇이 달라질까?", metadata: { channel: "threads", space: "personal", posts: POSTS }, record_type: "content_publish", description: "", status: "ready", stage: "approved", priority: "normal", brand: "", team: "", owner_id: OWNER,
    assignee_id: null, parent_id: null, due_date: null, starts_at: null, ends_at: null, progress: 0, metric_target: null, metric_current: null, metric_unit: "", amount: null, currency: "KRW", source_url: null, tags: [], version: 3, created_by: OWNER, updated_by: OWNER, created_at: AT, updated_at: AT, archived_at: null };
}
function connection(ownerId: string, name: string, teamShared = false) {
  return { platform: "threads", ownerId, accountName: name, accountType: "THREADS", teamShared, status: "connected", mock: false, expiresAt: "2030-01-01T00:00:00.000Z", publicationAccountKey: (ownerId === OWNER ? "a" : "b").repeat(64) };
}
function publication(state: string, publishedCount: number) {
  return { state, mode: "live", accountOwnerId: OWNER, accountName: "fixture_writer", posts: POSTS, publishedCount, total: POSTS.length, permalink: publishedCount ? "https://www.threads.com/@fixture_writer/post/fixture" : "" };
}
async function workspace(page: Page) {
  const state = {
    item: fixture(), readiness: { mode: "live", enabled: true, ready: true, reason: "", connections: [connection(OWNER, "fixture_writer"), connection(SHARED, "fixture_team", true)], publication: null as ReturnType<typeof publication> | null },
    writes: [] as { path: string; body: Record<string, unknown> }[], external: [] as string[],
    failure: null as { nextState: string; status: number; message: string } | null, readFails: false,
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: OWNER, role: "authenticated", exp: expiresAt })).toString("base64url")}.fixture`;
  await page.addInitScript(({ owner, expiresAt, jwt }) => {
    localStorage.setItem("sb-reference-ui-test-auth-token", JSON.stringify({ access_token: jwt, refresh_token: "fixture-refresh-token", expires_at: expiresAt, expires_in: 3600, token_type: "bearer", user: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
  }, { owner: OWNER, expiresAt, jwt });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.hostname === "reference-ui-test.supabase.co" && url.pathname === "/rest/v1/os_profiles") return json({ id: OWNER, email: "fixture@example.test", display_name: "테스트 사용자", role: "member", team: "", is_active: true, must_change_password: false, finance_access: false });
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) { state.external.push(request.url()); return route.abort("blockedbyclient"); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.replace("/api/v1/content/automation/", "");
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>; state.writes.push({ path, body });
      if (path === `threads-publication/${ITEM}`) {
        if (state.failure) {
          state.readiness.publication = publication(state.failure.nextState, 1);
          state.readiness.ready = state.failure.nextState === "retryable";
          return json({ error: { code: "PUBLICATION_TEST_FAILURE", message: state.failure.message } }, state.failure.status);
        }
        state.readiness.publication = { ...publication(state.readiness.mode === "mock" ? "mock_complete" : "published", POSTS.length), mode: state.readiness.mode, accountOwnerId: String(body.accountOwnerId), permalink: state.readiness.mode === "mock" ? "" : "https://www.threads.com/@fixture_writer/post/fixture" };
        state.readiness.ready = false;
        if (state.readiness.mode !== "mock") state.item = { ...state.item, status: "published", version: 4 };
        return json(state.readiness);
      }
      return json({ error: { message: "Unexpected mutation" } }, 400);
    }
    if (path === `threads-publication/${ITEM}`) return state.readFails ? json({ error: { message: "발행 상태를 다시 읽지 못했습니다." } }, 503) : json(state.readiness);
    if (path === "items") return json({ items: [state.item] });
    if (path === "publications") return json({ publications: [] });
    if (path === "review-log") return json({ reviews: [] });
    return json({ records: [], notifications: [], requests: [], policies: [], ok: true });
  });
  return state;
}
const panel = (page: Page) => page.getByRole("region", { name: "Threads 공식 API 발행" });
const confirm = (page: Page) => panel(page).getByRole("checkbox");
const publish = (page: Page) => panel(page).getByRole("button", { name: "확인하고 Threads에 발행", exact: true });
async function open(page: Page) { await page.goto(`/automation/calendar?tab=schedule&pub=${ITEM}`); await expect(panel(page).getByRole("button", { name: "발행 상태 확인" })).toBeEnabled(); }

test("approved chain requires explicit account confirmation and preserves the full preview", async ({ page }, testInfo) => {
  const state = await workspace(page); await open(page);
  expect(state.writes).toEqual([]); await expect(publish(page)).toBeDisabled();
  for (const post of POSTS) await expect(panel(page).getByText(post, { exact: true })).toBeVisible();
  await confirm(page).check(); await expect(publish(page)).toBeEnabled();
  await panel(page).getByLabel("게시할 Threads 계정").selectOption(SHARED);
  await expect(confirm(page)).not.toBeChecked(); await expect(publish(page)).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("threads-api-ready.png"), fullPage: true }); await confirm(page).check();
  await publish(page).click();
  await expect(panel(page).getByText("발행 완료", { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "게시된 본문 보기" })).toHaveAttribute("href", "https://www.threads.com/@fixture_writer/post/fixture");
  expect(state.writes).toEqual([{ path: `threads-publication/${ITEM}`, body: { expectedVersion: 3, accountOwnerId: SHARED, expectedAccountKey: "b".repeat(64), confirm: true } }]);
  await page.reload(); await expect(panel(page).getByText("발행 완료", { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(1); expect(state.external).toEqual([]);
});

test("setup and approval gates have a next step and cannot dispatch", async ({ page }) => {
  const state = await workspace(page); state.readiness.enabled = false; state.readiness.ready = false; state.readiness.connections = []; state.readiness.reason = "공식 API 발행을 준비하고 있습니다. 연결 설정이 끝나면 사용할 수 있습니다.";
  await open(page); await expect(panel(page).getByText(state.readiness.reason)).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "내 계정에서 Threads 연결 확인" })).toHaveAttribute("href", "/settings/account");
  await expect(confirm(page)).toBeDisabled(); await expect(publish(page)).toBeDisabled(); expect(state.writes).toEqual([]);
  state.item.status = "draft"; await page.reload();
  await expect(panel(page).getByRole("link", { name: "원고 최종 확인으로 이동" })).toHaveAttribute("href", `/automation/review?sel=${ITEM}`);
  await expect(confirm(page)).toBeDisabled(); expect(state.writes).toEqual([]);
});

test("partial result fixes the account and resumes only on a new human confirmation", async ({ page }) => {
  const state = await workspace(page); state.readiness.publication = publication("retryable", 1);
  await open(page); await expect(panel(page).getByLabel("게시할 Threads 계정")).toBeDisabled();
  await expect(panel(page).getByText(/남은 2개를 이어 올립니다/)).toBeVisible();
  const resume = panel(page).getByRole("button", { name: "확인하고 남은 글 발행" });
  await expect(resume).toBeDisabled(); await confirm(page).check(); await resume.click();
  await expect(panel(page).getByText("발행 완료", { exact: true })).toBeVisible(); expect(state.writes[0].body.accountOwnerId).toBe(OWNER); expect(state.writes).toHaveLength(1);
});

test("a retry with no published posts can replace a withdrawn shared account only after new confirmation", async ({ page }) => {
  const state = await workspace(page);
  state.readiness.publication = { ...publication("retryable", 0), accountOwnerId: SHARED, accountName: "fixture_team" };
  await open(page);
  const account = panel(page).getByLabel("게시할 Threads 계정");
  await expect(account).toBeEnabled(); await expect(account).toHaveValue(SHARED);
  await expect(panel(page).getByText(/아직 게시된 글이 없습니다/)).toBeVisible();
  await confirm(page).check(); await expect(publish(page)).toBeEnabled();
  await account.selectOption(OWNER);
  await expect(confirm(page)).not.toBeChecked(); await expect(publish(page)).toBeDisabled();
  state.readiness.connections = state.readiness.connections.filter(row => row.ownerId !== SHARED);
  await panel(page).getByRole("button", { name: "발행 상태 확인" }).click();
  await expect(account).toBeEnabled(); await expect(account).toHaveValue(OWNER);
  await expect(confirm(page)).not.toBeChecked(); await expect(publish(page)).toBeDisabled();
  expect(state.writes).toEqual([]);
  await confirm(page).check(); await publish(page).click();
  await expect(panel(page).getByText("발행 완료", { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: `threads-publication/${ITEM}`, body: { expectedVersion: 3, accountOwnerId: OWNER, expectedAccountKey: "a".repeat(64), confirm: true } }]);
  expect(state.external).toEqual([]);
});

test("uncertain publication blocks any repeat even after reload", async ({ page }) => {
  const state = await workspace(page); state.failure = { nextState: "uncertain", status: 409, message: "직전 게시 결과 확인이 필요합니다." };
  await open(page); await confirm(page).check(); await publish(page).click();
  await expect(panel(page).getByText("게시 결과 확인 필요", { exact: true })).toBeVisible();
  await expect(publish(page)).toHaveCount(0); await expect(confirm(page)).toHaveCount(0); expect(state.writes).toHaveLength(1);
  await panel(page).getByRole("button", { name: "발행 상태 확인" }).click();
  await page.reload(); await expect(panel(page).getByText("게시 결과 확인 필요", { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(1);
});

test("definitive failure still requires a manual status refresh before retry", async ({ page }) => {
  const state = await workspace(page); state.failure = { nextState: "retryable", status: 409, message: "플랫폼에서 요청을 거절했습니다." };
  await open(page); await confirm(page).check(); await publish(page).click();
  await expect(panel(page).getByText(/다시 누르기 전에/)).toBeVisible(); await expect(confirm(page)).toBeDisabled(); expect(state.writes).toHaveLength(1);
  await panel(page).getByRole("button", { name: "발행 상태 확인" }).click(); await expect(confirm(page)).toBeEnabled();
  await expect(confirm(page)).not.toBeChecked(); expect(state.writes).toHaveLength(1);
});

test("a failed status read disables dispatch and does not erase the shown manuscript", async ({ page }) => {
  const state = await workspace(page); await open(page); state.readFails = true;
  await panel(page).getByRole("button", { name: "발행 상태 확인" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("발행 상태를 다시 읽지 못했습니다");
  await expect(publish(page)).toBeDisabled(); await expect(confirm(page)).toBeDisabled();
  await expect(panel(page).getByText(POSTS[0], { exact: true })).toBeVisible(); expect(state.writes).toEqual([]);
});

test("mock completion is never presented as a real post", async ({ page }) => {
  const state = await workspace(page); state.readiness.mode = "mock"; state.readiness.connections = state.readiness.connections.map(row => ({ ...row, mock: true }));
  await open(page); await expect(panel(page).getByText(/실제 Threads에 게시하지 않습니다/)).toBeVisible();
  await confirm(page).check(); await panel(page).getByRole("button", { name: "모의 API 발행 확인" }).click();
  await expect(panel(page).getByText("모의 발행 확인 완료", { exact: true })).toBeVisible(); await expect(panel(page).getByText("발행 완료", { exact: true })).toHaveCount(0);
  expect(state.item.status).toBe("ready"); expect(state.external).toEqual([]);
});

test("a live receipt stays a real receipt when the environment later enters mock mode", async ({ page }) => {
  const state = await workspace(page); state.item.status = "published"; state.readiness.mode = "mock"; state.readiness.ready = false;
  state.readiness.publication = publication("published", POSTS.length);
  await open(page); await expect(panel(page).getByText(/3\/3개 게시 확인/)).toBeVisible();
  await expect(panel(page).getByText(/모의 처리/)).toHaveCount(0); await expect(panel(page).getByRole("checkbox")).toHaveCount(0); expect(state.writes).toEqual([]);
});

test("an unverified or changed account requires fresh confirmation", async ({ page }) => {
  const state = await workspace(page); state.readiness.connections[0].publicationAccountKey = "";
  await open(page); await expect(confirm(page)).toBeDisabled(); await expect(publish(page)).toBeDisabled();
  await expect(panel(page).getByText(/게시 계정을 다시 확인해야 합니다/)).toBeVisible();
  state.readiness.connections[0].publicationAccountKey = "c".repeat(64);
  await panel(page).getByRole("button", { name: "발행 상태 확인" }).click(); await confirm(page).check();
  state.readiness.connections[0].publicationAccountKey = "d".repeat(64); state.readiness.connections[0].accountName = "fixture_new_account";
  await panel(page).getByRole("button", { name: "발행 상태 확인" }).click();
  await expect(confirm(page)).not.toBeChecked(); await expect(publish(page)).toBeDisabled();
  await expect(confirm(page)).toHaveAccessibleName(/fixture_new_account/); await confirm(page).check(); await publish(page).click();
  await expect(panel(page).getByText("발행 완료", { exact: true })).toBeVisible();
  expect(state.writes[0].body.expectedAccountKey).toBe("d".repeat(64)); expect(state.writes).toHaveLength(1);
});

test("mobile keeps the main action clear and manual operations secondary", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); const state = await workspace(page); await open(page);
  await expect(page.getByText("직접 게시한 기존 글 기록", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "앱에서 직접 게시함", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "알림 예약", exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: testInfo.outputPath("threads-api-mobile.png"), fullPage: true });
  expect(state.writes).toEqual([]);
});
