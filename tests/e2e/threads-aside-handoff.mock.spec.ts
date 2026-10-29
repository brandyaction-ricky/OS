import { expect, test, type Page } from "@playwright/test";
import type { OsRecord } from "../../lib/record-types";

// Fictional local session. Every API request is intercepted and external traffic is
// rejected. These tests exercise the employee's handoff, not a real AI or database.
test.skip(process.env.REFERENCE_MOCK_E2E !== "true", "Requires the isolated local mock-auth server.");
const OWNER = "00000000-0000-4000-8000-000000000001";
const TOPIC = "00000000-0000-4000-8000-000000000021";
const ITEM = "00000000-0000-4000-8000-000000000041";
const JOB = "00000000-0000-4000-8000-000000000031";
const AT = "2026-01-15T03:00:00.000Z";
const POSTS = [
  "팀을 옮겼는데 같은 일이 더 어려워졌다.\n\n직무 이름은 같아도 실제 일하는 순서는 달랐다.",
  "잘하던 일에서 헤매기 시작했다고 경험까지 사라진 것은 아니다.\n\n새 팀이 일을 나누고 확인하는 방식부터 볼 수 있다.",
  "지난주 끝낸 일 하나만 다시 떠올려보자.\n\n어디에서 기다렸고, 누구에게 확인받았는지 적어보면 막힌 곳이 보인다.",
];

function record(id: string, title: string, metadata: Record<string, unknown>): OsRecord {
  return { id, title, metadata, record_type: "content_publish", description: "", status: "draft", stage: "making", priority: "normal", brand: "", team: "", owner_id: OWNER,
    assignee_id: null, parent_id: null, due_date: null, starts_at: null, ends_at: null, progress: 0, metric_target: null, metric_current: null, metric_unit: "", amount: null, currency: "KRW",
    source_url: null, tags: [], version: 1, created_by: OWNER, updated_by: OWNER, created_at: AT, updated_at: AT, archived_at: null };
}
function job(status: "backlog" | "active" | "done" = "backlog") {
  return { ...record(JOB, "합성 쓰레드 집필 작업", {
    proc: "threads", targetId: ITEM, jobNo: 1, space: "personal", threadsInput: { schemaVersion: 1 },
    ...(status === "active" ? { via: "now" } : {}),
    ...(status === "done" ? { result: { posts: POSTS } } : {}),
  }), record_type: "ai_job", status, stage: status === "done" ? "completed" : status === "active" ? "running" : "queued" } as OsRecord;
}
async function mockWorkspace(page: Page, options: { existing?: "backlog" | "active" | "done"; clipboardFails?: boolean; shared?: boolean } = {}) {
  const item = { ...record(ITEM, "같은 일을 다른 팀에서 하면 무엇이 달라질까?", { channel: "threads", space: "personal", posts: [], ...(options.shared ? { shared: "team" } : {}) }), parent_id: TOPIC };
  if (options.shared) item.owner_id = "00000000-0000-4000-8000-000000000002";
  const topic = { ...record(TOPIC, item.title, { channels: ["threads"], brief: {
    one: item.title, who: "같은 직무로 팀을 옮긴 독자", message: "직무 이름과 실제 업무 순서를 나누어 본다.", sources: "https://example.test/source", warn: "합성 시험 자료",
  } }), record_type: "content_topic", stage: "confirmed", owner_id: item.owner_id };
  const state = {
    item, topic, jobs: options.existing ? [job(options.existing)] : [] as OsRecord[],
    writes: [] as { path: string; body: Record<string, unknown> }[], reads: [] as string[], external: [] as string[],
    failJobsAfterPaste: false, pasted: false,
    pasteError: null as { status: number; message: string; code: string } | null,
    instructionsError: null as { status: number; message: string; code: string } | null,
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: OWNER, role: "authenticated", exp: expiresAt })).toString("base64url")}.fixture`;
  await page.addInitScript(({ owner, expiresAt, jwt, clipboardFails }) => {
    localStorage.setItem("sb-reference-ui-test-auth-token", JSON.stringify({ access_token: jwt, refresh_token: "fixture-refresh-token", expires_at: expiresAt, expires_in: 3600, token_type: "bearer",
      user: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
    const win = window as unknown as { copiedText: string; clipboardFails: boolean };
    win.clipboardFails = clipboardFails;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => {
      if (win.clipboardFails) throw new DOMException("Clipboard denied by test", "NotAllowedError");
      win.copiedText = value;
    } } });
  }, { owner: OWNER, expiresAt, jwt, clipboardFails: Boolean(options.clipboardFails) });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.hostname === "reference-ui-test.supabase.co" && url.pathname === "/rest/v1/os_profiles") return json({ id: OWNER, email: "fixture@example.test", display_name: "테스트 사용자", role: "member", team: "", is_active: true, must_change_password: false, finance_access: false });
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) { state.external.push(request.url()); return route.abort("blockedbyclient"); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.replace("/api/v1/content/automation/", "");
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>; state.writes.push({ path, body });
      if (path === "jobs") {
        expect(body.proc).toBe("threads"); expect(body.targetId).toBe(ITEM);
        const existing = state.jobs.find(row => ["backlog", "active"].includes(row.status));
        if (existing) return json({ job: existing, reused: true });
        const created = job(); state.jobs.push(created); return json({ job: created });
      }
      if (path === `jobs/${JOB}/paste`) {
        if (state.pasteError) return json({ error: { code: state.pasteError.code, message: state.pasteError.message } }, state.pasteError.status);
        const current = state.jobs.find(row => row.id === JOB)!;
        const saved = { ...current, status: "done", stage: "completed", version: current.version + 1, metadata: { ...current.metadata, result: body.result, via: "copy" } };
        state.jobs = state.jobs.map(row => row.id === JOB ? saved : row);
        state.pasted = true;
        return json({ job: saved });
      }
      return json({ error: { message: "Unexpected mutation in the handoff test" } }, 400);
    }
    state.reads.push(path);
    const team = url.searchParams.get("scope") === "team";
    if (path === "items") return json({ items: options.shared ? (team ? [state.item] : []) : (team ? [] : [state.item]) });
    if (path === "topics") return json({ topics: options.shared ? (team ? [state.topic] : []) : (team ? [] : [state.topic]) });
    if (path === "jobs") {
      if (state.failJobsAfterPaste && state.pasted) return json({ error: { code: "TEMPORARY_READ_ERROR", message: "집필 요청을 다시 읽지 못했습니다." } }, 503);
      return json({ jobs: team ? [] : state.jobs });
    }
    if (path === "review-log") return json({ reviews: [] });
    if (path === "reviewers") return json({ reviewers: [], canReview: false, canManage: false });
    if (path === `jobs/${JOB}/instructions`) {
      if (state.instructionsError) return json({ error: { code: state.instructionsError.code, message: state.instructionsError.message } }, state.instructionsError.status);
      return json({ job: state.jobs.find(row => row.id === JOB), target: {
        schemaVersion: 1, workflow: "threads_reference_v1", proc: "threads", target: { id: ITEM, title: item.title, version: 1, posts: [] },
        topic: { title: topic.title, brief: topic.metadata.brief },
        canonical: { title: "합성 쓰레드 정본", version: 21, body: "집필 입력 계약: threads_editorial_v1\n질문에 끝까지 답한다.\n합성 정본 마지막 문장." },
      }, instructions: "미승인 결과만 준비한다.", skill: { title: "합성 개인 스킬", version: 1, body: "장면부터 쓴다." }, resultFormat: '{"posts":["본문","관점 댓글","적용 대댓글"]}' });
    }
    if (path === `items/${ITEM}`) return json({ record: state.item });
    if (/^items\/[^/]+\/comments$/.test(path)) return json({ comments: [] });
    return json({ records: [], notifications: [], requests: [], policies: [], ok: true });
  });
  return state;
}
const writing = (page: Page) => page.getByRole("region", { name: "Aside로 쓰레드 집필" });
const copy = (page: Page) => writing(page).getByRole("button", { name: "Aside에 보낼 요청문 복사", exact: true });
const result = (page: Page) => page.getByLabel("Aside가 작성한 결과", { exact: true });
const save = (page: Page) => writing(page).getByRole("button", { name: "미승인 초안 저장", exact: true });
async function openDraft(page: Page) { await page.goto(`/automation/threads?sel=${ITEM}`); await expect(writing(page)).toBeVisible(); }

test("an employee can copy, paste and save an unapproved draft on the same screen", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page); await openDraft(page);
  await expect(page.getByRole("dialog", { name: "내 AI로 보내기" })).toHaveCount(0);
  await expect(copy(page)).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("aside-first-action-desktop.png"), fullPage: true });
  await copy(page).click();
  await expect(result(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedText: string }).copiedText ?? "")).toContain("합성 정본 마지막 문장");
  const copied = await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText);
  expect(copied).toContain("합성 정본 마지막 문장"); expect(copied).toContain("합성 개인 스킬"); expect(copied).toContain(ITEM);
  await result(page).fill(`\`\`\`json\n${JSON.stringify({ posts: POSTS })}\n\`\`\``);
  await save(page).click();
  await expect(page.getByText(POSTS[0], { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/AI 결과 도착.*미승인/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/automation/threads\\?sel=${ITEM}$`));
  expect(state.jobs).toHaveLength(1); expect(state.jobs[0].metadata.result).toEqual({ posts: POSTS });
  expect(state.item.metadata.posts).toEqual([]); expect(state.item.status).toBe("draft");
  expect(state.writes.map(write => write.path)).toEqual(["jobs", `jobs/${JOB}/paste`]);
  expect(state.external).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("aside-unapproved-same-page.png"), fullPage: true });
});

test("clipboard denial leaves a selectable request and retry reuses the same job", async ({ page }) => {
  const state = await mockWorkspace(page, { clipboardFails: true }); await openDraft(page);
  await copy(page).click();
  const fallback = page.getByLabel(/^복사할 집필 요청문/);
  await expect(fallback).toBeVisible(); await expect(fallback).toHaveValue(/합성 정본 마지막 문장/);
  expect(state.jobs).toHaveLength(1);
  await page.evaluate(() => { (window as unknown as { clipboardFails: boolean }).clipboardFails = false; });
  await copy(page).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedText: string }).copiedText ?? "")).toContain("합성 정본 마지막 문장");
  expect(state.jobs).toHaveLength(1);
  expect(state.writes.every(write => write.path === "jobs")).toBe(true);
});

test("malformed and oversized results stay editable and never reach the save endpoint", async ({ page }) => {
  const state = await mockWorkspace(page, { existing: "backlog" }); await openDraft(page);
  await result(page).fill('{"posts": ['); await save(page).click();
  await expect(writing(page).getByRole("alert")).toBeVisible(); await expect(result(page)).toHaveValue('{"posts": [');
  const oversized = JSON.stringify({ posts: ["가".repeat(501)] });
  await result(page).fill(oversized); await save(page).click();
  await expect(writing(page).getByRole("alert")).toContainText("500"); await expect(result(page)).toHaveValue(oversized);
  expect(state.writes).toEqual([]);
});

test("an existing queued task survives refresh and can continue without duplicate creation", async ({ page }) => {
  const state = await mockWorkspace(page, { existing: "backlog" }); await openDraft(page);
  await copy(page).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedText: string }).copiedText ?? "")).toContain("합성 정본 마지막 문장");
  await page.reload(); await expect(writing(page)).toBeVisible();
  await copy(page).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedText: string }).copiedText ?? "")).toContain("합성 정본 마지막 문장");
  await result(page).fill(JSON.stringify({ posts: POSTS })); await save(page).click();
  await expect(page.getByText(POSTS[1], { exact: true }).last()).toBeVisible();
  expect(state.jobs).toHaveLength(1);
  expect(state.writes.filter(write => write.path !== "jobs").map(write => write.path)).toEqual([`jobs/${JOB}/paste`]);
});

test("a running worker task cannot be copied or overwritten and can be refreshed", async ({ page }) => {
  const state = await mockWorkspace(page, { existing: "active" }); await openDraft(page);
  await expect(copy(page)).toHaveCount(0);
  await expect(result(page)).toHaveCount(0);
  await expect(writing(page).getByRole("button", { name: "진행 상태 확인", exact: true })).toBeVisible();
  state.jobs = [job("done")];
  await writing(page).getByRole("button", { name: "진행 상태 확인", exact: true }).click();
  await expect(page.getByText(POSTS[0], { exact: true }).last()).toBeVisible();
  expect(state.writes).toEqual([]);
});

test("a stale source error retains the result and does not claim successful storage", async ({ page }) => {
  const state = await mockWorkspace(page, { existing: "backlog" });
  state.pasteError = { status: 409, code: "THREADS_INPUT_STALE", message: "주제나 근거가 변경되었습니다. 최신 기준으로 다시 요청해 주세요." };
  await openDraft(page); const text = JSON.stringify({ posts: POSTS });
  await result(page).fill(text); await save(page).click();
  await expect(writing(page).getByRole("alert")).toContainText("주제나 근거가 변경"); await expect(result(page)).toHaveValue(text);
  await expect(page.getByText(/AI 결과 도착.*미승인/)).toHaveCount(0);
  expect(state.jobs[0].status).toBe("backlog"); expect(state.item.metadata.posts).toEqual([]);
});

test("a shared draft belonging to another employee exposes no handoff controls", async ({ page }) => {
  const state = await mockWorkspace(page, { shared: true });
  await page.goto(`/automation/threads?scope=team&sel=${ITEM}`);
  await expect(page.getByRole("heading", { name: /쓰레드 · v1/ })).toBeVisible();
  await expect(writing(page)).toHaveCount(0);
  await expect(page.getByLabel("Aside가 작성한 결과")).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("the narrow workspace supports keyboard handoff without horizontal overflow", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page); await page.setViewportSize({ width: 390, height: 844 }); await openDraft(page);
  await expect(copy(page)).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("aside-first-action-mobile.png"), fullPage: true });
  await copy(page).focus(); await page.keyboard.press("Enter"); await expect(result(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedText: string }).copiedText ?? "")).toContain("합성 정본 마지막 문장");
  await result(page).fill(JSON.stringify({ posts: POSTS })); await save(page).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText(POSTS[2], { exact: true }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(state.writes.map(write => write.path)).toEqual(["jobs", `jobs/${JOB}/paste`]);
  await page.screenshot({ path: testInfo.outputPath("aside-unapproved-mobile.png"), fullPage: true });
});

test("an older blocked request does not hide a newer completed draft", async ({ page }) => {
  const state = await mockWorkspace(page, { existing: "done" });
  state.jobs.push({ ...job(), id: "00000000-0000-4000-8000-000000000030", status: "blocked", stage: "blocked",
    created_at: "2026-01-14T03:00:00.000Z", updated_at: "2026-01-14T03:00:00.000Z" });
  await openDraft(page);
  await expect(writing(page).getByText("미승인 원고가 도착했습니다.", { exact: true })).toBeVisible();
  await expect(writing(page).getByText("이전 집필 요청이 멈췄습니다.", { exact: true })).toHaveCount(0);
  await expect(page.getByText(POSTS[0], { exact: true }).last()).toBeVisible();
  await expect(result(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("a saved draft remains visible when the following refresh fails", async ({ page }) => {
  const state = await mockWorkspace(page, { existing: "backlog" }); state.failJobsAfterPaste = true;
  await openDraft(page); await result(page).fill(JSON.stringify({ posts: POSTS })); await save(page).click();
  await expect(page.getByText(/AI 결과 도착.*미승인/)).toBeVisible();
  await expect(page.getByText(POSTS[0], { exact: true }).last()).toBeVisible();
  await expect(writing(page).getByRole("status")).toContainText("미승인 초안을 저장했습니다");
  expect(state.jobs[0].status).toBe("done");
  expect(state.writes.map(write => write.path)).toEqual([`jobs/${JOB}/paste`]);
  expect(state.item.metadata.posts).toEqual([]);
});
