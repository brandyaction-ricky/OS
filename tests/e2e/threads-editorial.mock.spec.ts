import { expect, test, type Page } from "@playwright/test";
import type { OsRecord } from "../../lib/record-types";
import type { ThreadsEditorialCandidate } from "../../lib/threads-editorial";

// Fictional local auth and all API calls are intercepted. No real account or database.
test.skip(process.env.REFERENCE_MOCK_E2E !== "true", "Requires the isolated local mock-auth server.");
const OWNER = "00000000-0000-4000-8000-000000000001";
const AT = "2026-01-15T03:00:00.000Z";
function candidate(route: "insight" | "person", suffix = ""): ThreadsEditorialCandidate {
  return { title: `합성 주제${suffix}: 같은 일을 다른 팀에서 하면 무엇이 달라질까?`, editorial_route: route, editorial_material: {
    firstParagraph: "같은 일을 하는데 팀을 옮기고 나서 실수가 늘었다. 일하는 순서부터 달라졌다면?",
    readerQuestion: "같은 일을 다른 팀에서 하면 무엇이 달라질까?", readerContext: "같은 직무로 팀을 바꾸려는 독자",
    scene: "테스트용 합성 장면: 작업자는 팀을 옮긴 뒤 같은 작업을 다른 순서로 했다.", sceneKind: route === "person" ? "documented" : "hypothetical",
    directAnswer: "직무 이름뿐 아니라 실제로 맡는 행동과 그 순서를 비교한다.", perspective: "직무는 같아도 작업 범위는 달라질 수 있다.",
    application: "최근 완료한 작업의 실제 순서를 적어본다.", reasonToRead: "직무를 유지하면서 다른 환경에서 일하면 무엇이 바뀌는지 궁금하기 때문.",
    sources: [{ kind: route === "insight" ? "os_document" : "public", title: "합성 원문", url: route === "insight" ? "https://brandyaction-os.vercel.app/knowledge/doc/00000000-0000-4000-8000-000000000099" : "https://example.test/interview", locator: "첫 번째 문단", evidenceNote: "합성 fixture. 실제 공개 내용이 아니다." }],
    ...(route === "person" ? { personName: "합성 예시 인물", eventDate: "2026-01-01" } : {}),
  } };
}
function record(id: string, title: string, metadata: Record<string, unknown>): OsRecord {
  return { id, title, metadata, record_type: "content_topic", description: "", status: "draft", stage: "candidate", priority: "normal", brand: "", team: "", owner_id: OWNER,
    assignee_id: null, parent_id: null, due_date: null, starts_at: null, ends_at: null, progress: 0, metric_target: null, metric_current: null, metric_unit: "", amount: null, currency: "KRW",
    source_url: null, tags: [], version: 1, created_by: OWNER, updated_by: OWNER, created_at: AT, updated_at: AT, archived_at: null };
}
async function mockWorkspace(page: Page, canonicalVersion = 16) {
  const state = { topics: [] as OsRecord[], items: [] as OsRecord[], writes: [] as { path: string; body: Record<string, unknown> }[], external: [] as string[], failTitle: "", failOnce: false };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: OWNER, role: "authenticated", exp: expiresAt })).toString("base64url")}.fixture`;
  await page.addInitScript(({ owner, expiresAt, jwt }) => {
    localStorage.setItem("sb-reference-ui-test-auth-token", JSON.stringify({ access_token: jwt, refresh_token: "fixture-refresh-token", expires_at: expiresAt, expires_in: 3600, token_type: "bearer",
      user: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copiedText: string }).copiedText = value; } } });
  }, { owner: OWNER, expiresAt, jwt });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.hostname === "reference-ui-test.supabase.co" && url.pathname === "/rest/v1/os_profiles") return json({ id: OWNER, email: "fixture@example.test", display_name: "테스트 사용자", role: "admin", team: "", is_active: true, must_change_password: false, finance_access: false });
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) { state.external.push(request.url()); return route.abort("blockedbyclient"); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.replace("/api/v1/content/automation/", "");
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>; state.writes.push({ path, body });
      if (path === "topics") {
        if (state.failOnce && body.title === state.failTitle) {
          state.failOnce = false;
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "합성 일시 오류" } }) });
        }
        const previous = state.topics.find(topic => topic.metadata.requestId === body.requestId);
        if (previous) return json({ topic: previous });
        const topic = record(`00000000-0000-4000-8000-${String(state.topics.length + 21).padStart(12, "0")}`, String(body.title), { ...body, brief: {}, channels: [] });
        state.topics.push(topic); return json({ topic });
      }
      const startId = path.match(/^topics\/([^/]+)\/start$/)?.[1];
      if (startId) {
        const topic = state.topics.find(row => row.id === startId)!;
        topic.metadata = { ...topic.metadata, brief: body.brief, channels: ["threads"] }; topic.stage = "confirmed";
        const item: OsRecord = { ...record("00000000-0000-4000-8000-000000000041", topic.title, { channel: "threads", space: "personal", posts: [] }), record_type: "content_publish", stage: "making", parent_id: topic.id };
        state.items.push(item); return json({ topic, items: [item] });
      }
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { message: "예상하지 않은 변경 요청" } }) });
    }
    if (path === "topics") return json({ topics: state.topics, collectionContext: { canonicalUrl: "https://example.test/canonical", canonicalTitle: "합성 쓰레드 정본", canonicalVersion } });
    if (path === "items") return json({ items: state.items });
    if (path === "reviewers") return json({ reviewers: [], canReview: true, canManage: true });
    if (path === "jobs") return json({ jobs: [] });
    if (path === "review-log") return json({ reviews: [] });
    if (/^items\/[^/]+\/comments$/.test(path)) return json({ comments: [] });
    return json({ records: [], notifications: [], requests: [], policies: [], ok: true });
  });
  return state;
}
async function prepare(page: Page, route: "insight" | "person", candidates: unknown[]) {
  await page.getByRole("region", { name: "쓰레드 주제 발굴" }).getByRole("button", { name: route === "insight" ? /인사이트형/ : /인물 분석형/ }).click();
  await page.getByText("Aside가 준비한 후보 등록", { exact: true }).click();
  await page.getByLabel("Aside 후보 결과").fill(JSON.stringify({ candidates }));
  await page.getByRole("button", { name: "내용 확인", exact: true }).click();
}

test("route instructions and candidate preview keep human selection before production", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/topics");
  const workspace = page.getByRole("region", { name: "쓰레드 주제 발굴" });
  await expect(workspace.getByRole("link", { name: /레퍼런스형/ })).toHaveAttribute("href", "/automation/references");
  await workspace.getByRole("button", { name: /인사이트형/ }).click();
  await expect(page.getByLabel("Aside 후보 결과")).not.toBeVisible();
  await page.getByRole("button", { name: "Aside 후보 요청 복사" }).click();
  const copied = await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText);
  expect(copied).toContain("v16"); expect(copied).toContain("firstParagraph"); expect(copied).toContain("최소 1개의 접근 가능한 OS 문서");
  expect(copied).toContain("후보 자동 선택"); expect(copied).toContain("승인, 예약·발행");
  await page.getByText("Aside가 준비한 후보 등록", { exact: true }).click();
  await page.getByLabel("Aside 후보 결과").fill(JSON.stringify({ candidates: [candidate("insight")] }));
  await page.getByRole("button", { name: "내용 확인", exact: true }).click();
  await expect(page.locator(".te-first-paragraph")).toContainText(candidate("insight").editorial_material.firstParagraph);
  expect(state.writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("insight-candidate-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "후보 1개 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "후보 저장 완료" })).toBeDisabled();
  expect(state.topics).toHaveLength(1); expect(state.items).toHaveLength(0);
  await page.locator(".ca-v07-topic").filter({ hasText: candidate("insight").title }).click();
  await expect(page.getByLabel("한 줄 주제", { exact: true })).toHaveValue(candidate("insight").title);
  await expect(page.getByLabel("쓰레드 원고를 팀 검토함에 공유", { exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "카드뉴스", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기획 확인하고 쓰레드 집필로 이동", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "기획 확인하고 쓰레드 집필로 이동", exact: true }).click();
  await expect(page).toHaveURL(/\/automation\/threads\?sel=/);
  const started = state.writes.find(write => write.path.endsWith("/start"))!;
  expect(started.body).not.toHaveProperty("teamThreads");
  expect(Object.keys(started.body.channels as object)).toEqual(["threads"]);
  expect(state.writes.some(write => /publish|approve|adopt|schedule/.test(write.path))).toBe(false);
  expect(state.external).toEqual([]);
});

test("partial save retries skip completed candidates and retain ids after refresh", async ({ page }) => {
  const state = await mockWorkspace(page), first = candidate("insight", " 하나"), second = candidate("insight", " 둘");
  state.failTitle = second.title; state.failOnce = true;
  await page.goto("/automation/topics"); await prepare(page, "insight", [first, second]);
  await page.getByRole("button", { name: "후보 2개 저장", exact: true }).click();
  await expect(page.locator(".te-workspace").getByRole("alert")).toContainText("1개 저장됨");
  await page.getByRole("button", { name: "남은 후보 1개 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "후보 저장 완료" })).toBeDisabled();
  expect(state.topics).toHaveLength(2);
  const secondAttempts = state.writes.filter(write => write.body.title === second.title);
  expect(secondAttempts).toHaveLength(2); expect(secondAttempts[0].body.requestId).toBe(secondAttempts[1].body.requestId);
  expect(state.writes.filter(write => write.body.title === first.title)).toHaveLength(1);
  await page.reload(); await prepare(page, "insight", [first]);
  await page.getByRole("button", { name: "후보 1개 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "후보 저장 완료" })).toBeDisabled();
  expect(state.topics).toHaveLength(2);
  const repeated = state.writes.filter(write => write.body.title === first.title);
  expect(repeated[0].body.requestId).toBe(repeated[1].body.requestId);
});

test("person requires a documented scene and preserves public-source preview on mobile", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/automation/topics");
  const invalid = candidate("person"); delete invalid.editorial_material.eventDate;
  await prepare(page, "person", [invalid]);
  await expect(page.locator(".te-workspace").getByRole("alert")).toContainText("인물·시점·실제 장면");
  expect(state.writes).toHaveLength(0);
  await page.getByLabel("Aside 후보 결과").fill(JSON.stringify({ candidates: [candidate("person")] }));
  await page.getByRole("button", { name: "내용 확인", exact: true }).click();
  await expect(page.locator(".te-candidate")).toContainText("합성 예시 인물 · 2026-01-01");
  await expect(page.locator(".te-candidate")).toContainText("원문 확인 장면");
  await page.screenshot({ path: testInfo.outputPath("person-candidate-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "후보 1개 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "후보 저장 완료" })).toBeDisabled();
  expect(state.topics[0].metadata.editorial_route).toBe("person");
});

test("zero candidates are a valid result and do not create records", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/topics"); await prepare(page, "insight", []);
  await expect(page.getByRole("region", { name: "준비한 후보" })).toContainText("적합한 후보를 찾지 못했습니다");
  await expect(page.getByRole("button", { name: /후보.*저장/ })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test("old canonical blocks new route request copy and candidate registration", async ({ page }) => {
  const state = await mockWorkspace(page, 15);
  await page.goto("/automation/topics"); await prepare(page, "insight", [candidate("insight")]);
  await expect(page.getByRole("button", { name: "Aside 후보 요청 복사" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "후보 1개 저장", exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});
