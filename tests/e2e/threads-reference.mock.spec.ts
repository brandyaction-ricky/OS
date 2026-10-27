import { expect, test, type Page } from "@playwright/test";
import type { OsRecord } from "../../lib/record-types";
import type { ThreadsReferenceItem } from "../../lib/threads-reference";

// Run against a separate local Next process with NEXT_PUBLIC_DEMO_MODE=false,
// NEXT_PUBLIC_SUPABASE_URL=https://reference-ui-test.supabase.co and a fictional
// publishable key. All API/auth requests are intercepted; no real account is used.
test.skip(process.env.REFERENCE_MOCK_E2E !== "true", "Requires the isolated local mock-auth server.");
const OWNER = "00000000-0000-4000-8000-000000000001";
const FIRST = "00000000-0000-4000-8000-000000000011";
const SECOND = "00000000-0000-4000-8000-000000000012";
const CREATED = "00000000-0000-4000-8000-000000000013";
const TOPIC = "00000000-0000-4000-8000-000000000021";
const JOB = "00000000-0000-4000-8000-000000000031";
const AT = "2026-01-15T03:00:00.000Z";

function reference(id: string, title: string, verified = false): ThreadsReferenceItem {
  return { id, title, url: `https://example.test/${id}`, platform: "threads", author: "예시 작성자", publishedAt: "2026-01-14", observedAt: AT,
    metrics: { views: { value: null, verified: false }, likes: { value: verified ? 0 : null, verified }, comments: { value: null, verified: false }, reposts: { value: null, verified: false } },
    readScope: "full", readNote: "예시 본문의 반응 표시를 직접 확인함.", capturedBy: "human", scene: "예시 작성자가 한 번에 한 가지 일을 마쳤다.",
    readerQuestion: "일을 작게 나누면 무엇이 달라질까?", addedPerspective: "계획 크기와 시작 비용을 함께 살펴본다." };
}
function record(id: string, title: string, metadata: Record<string, unknown>): OsRecord {
  return { id, title, metadata, record_type: "content_topic", description: "", status: "draft", stage: "candidate", priority: "normal", brand: "", team: "", owner_id: OWNER,
    assignee_id: null, parent_id: null, due_date: null, starts_at: null, ends_at: null, progress: 0, metric_target: null, metric_current: null, metric_unit: "", amount: null, currency: "KRW",
    source_url: null, tags: [], version: 1, created_by: OWNER, updated_by: OWNER, created_at: AT, updated_at: AT, archived_at: null };
}

async function mockWorkspace(page: Page) {
  const first = reference("example-one", "가상 원문 하나", true), second = reference("example-two", "가상 원문 둘");
  const state = {
    references: [record(FIRST, first.title, { kind: "threads_reference", reference_items: [first] }), record(SECOND, second.title, { kind: "threads_reference", reference_items: [second] })],
    topics: [] as OsRecord[], writes: [] as { path: string; body: Record<string, unknown> }[], external: [] as string[],
  };
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
      if (path === "worker/next") return json({ end: false, runId: "fixture-run", remaining: 0,
        job: { ...record(JOB, "가상 쓰레드 작업", { proc: "threads", targetId: TOPIC, jobNo: 1 }), status: "active", record_type: "ai_job" },
        target: { schemaVersion: 1, workflow: "threads_reference_v1", proc: "threads", target: { id: TOPIC, title: "선택한 작업 제목", version: 1, brand: "", description: "", channel: "threads", posts: [] },
          topic: { id: TOPIC, title: "선택한 주제", version: 1, brief: { message: "선택한 브리프의 핵심" }, reference_items: [second] },
          canonical: { id: "fixture-canonical", title: "예시 회사 정본", version: 10, body: "정본 본문 시작\n승인한 예시와 장면을 확인한다.\n정본 본문 마지막", readAt: AT } },
        instructions: "선택한 주제만 집필한다.", skill: { title: "내 예시 스킬", slug: "fixture-skill", version: 3, body: "구체적인 장면부터 쓴다." }, resultFormat: '{"posts":["글"]}' });
      if (path === "topics" && body.kind === "threads_reference") {
        const created = record(CREATED, String(body.title), { kind: body.kind, editorial_workflow: body.editorial_workflow, reference_items: body.reference_items });
        state.references.push(created); return json({ topic: created });
      }
      if (path === "topics" && Array.isArray(body.referenceIds)) {
        const selected = state.references.filter(row => (body.referenceIds as string[]).includes(row.id));
        const topic = record(TOPIC, String(body.title), { source: "reference", editorial_workflow: "threads_reference_v1", reference_items: selected.flatMap(row => row.metadata.reference_items as ThreadsReferenceItem[]), channels: [], brief: {} });
        state.topics.push(topic); return json({ topic });
      }
      if (path === `topics/${SECOND}/archive-reference`) {
        state.references = state.references.filter(row => row.id !== SECOND); return json({ archived: true });
      }
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { message: "예상하지 않은 변경 요청" } }) });
    }
    if (path === "references") return json({ references: state.references, collectionContext: { canonicalUrl: "https://example.test/canonical", canonicalTitle: "예시 쓰레드 정본", canonicalVersion: 2 } });
    if (path === "worker/state") return json({ browser: { id: "fixture-browser", name: "시험 브라우저", registeredAt: AT }, rules: { per_run: 3, daily_max: 10, long_only_now: true }, run: null, pending: 1, todayTaken: 0 });
    if (path === "topics") return json({ topics: state.topics });
    if (path === "items") return json({ items: [] });
    if (path === "reviewers") return json({ reviewers: [], canReview: false, canManage: false });
    if (path === "jobs") return json({ jobs: [record(JOB, "가상 브리프 작업", { proc: "brief", targetId: TOPIC, jobNo: 1 }),].map(row => ({ ...row, record_type: "ai_job", status: "backlog" })) });
    if (path === `jobs/${JOB}/instructions`) return json({ target: { topic: { reference_items: [second] }, canonical: { title: "예시 집필 기준", version: 2, body: "원문의 장면과 독자의 질문을 이어 쓴다." } }, instructions: "확인한 근거만 사용한다.", skill: "개인 스킬 예시", resultFormat: { one: "한 줄 주제" } });
    if (path === "browsers") return json({ browsers: [] });
    if (path === "runs") return json({ runs: [], silent: false });
    return json({ records: [], notifications: [], requests: [], policies: [], ok: true });
  });
  return state;
}

test("registered evidence stays private and only checked references become a topic", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/references");
  await expect(page.locator(".tr-reference")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("references-comparison.png"), fullPage: true });
  await page.getByText("Aside에 원문 조사 맡기기", { exact: true }).click();
  await page.getByLabel("이번에 살펴볼 주제·범위", { exact: true }).fill("작은 계획의 실제 장면");
  await page.getByRole("button", { name: "Aside 조사 지침 복사" }).click();
  const collection = await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText);
  expect(collection).toContain("https://example.test/canonical");
  expect(collection).toContain("작은 계획의 실제 장면");
  expect(collection).toContain("최대 5개");
  expect(collection).toContain("수집함에 등록");
  await expect(page.locator(".tr-reference").filter({ hasText: "가상 원문 하나" }).getByText("확인한 반응 있음")).toBeVisible();
  await expect(page.locator(".tr-reference").filter({ hasText: "가상 원문 둘" }).getByText("반응 미확인")).toBeVisible();
  await expect(page.locator(".tr-reference").first().locator(".tr-metrics dd").nth(1)).toHaveText("0");
  await page.getByRole("button", { name: "+ 원문 등록" }).click();
  await page.getByLabel("제목", { exact: true }).fill("직접 등록한 가상 원문");
  await page.getByLabel("원문 URL", { exact: true }).fill("https://example.test/new-reference");
  await page.getByRole("combobox", { name: "읽은 범위", exact: true }).selectOption("partial");
  await page.getByRole("combobox", { name: "좋아요 확인", exact: true }).selectOption("verified");
  await page.getByLabel("좋아요 수", { exact: true }).fill("0");
  await page.getByRole("button", { name: "내 레퍼런스에 저장" }).click();
  await expect(page.locator(".tr-reference")).toHaveCount(3);
  const saved = state.writes[0].body;
  expect(saved.kind).toBe("threads_reference");
  const savedItem = (saved.reference_items as ThreadsReferenceItem[])[0];
  expect(savedItem.metrics.likes).toEqual({ value: 0, verified: true });
  expect(savedItem.metrics.views).toEqual({ value: null, verified: false });
  expect(savedItem.capturedBy).toBe("human");
  await page.getByLabel("가상 원문 둘 선택", { exact: true }).check();
  await page.getByLabel("주제 후보 이름", { exact: true }).fill("선택한 원문의 질문");
  await page.getByRole("button", { name: "주제 후보로 가져오기" }).click();
  await expect(page).toHaveURL(new RegExp(`/automation/topics\\?sel=${TOPIC}`));
  expect(state.writes[1].body.referenceIds).toEqual([SECOND]);
  expect(state.writes).toHaveLength(2);
  await expect(page.locator(".tr-evidence").getByText("가상 원문 둘", { exact: true })).toBeVisible();
  await expect(page.locator(".tr-evidence").getByText("가상 원문 하나", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("쓰레드", { exact: true })).not.toBeChecked();
  await page.getByLabel("쓰레드", { exact: true }).check();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.goto("/automation/references");
  await page.locator(".tr-reference").filter({ hasText: "가상 원문 둘" }).getByRole("button", { name: "보관", exact: true }).click();
  await expect(page.locator(".tr-reference")).toHaveCount(2);
  expect(state.writes[2]).toEqual({ path: `topics/${SECOND}/archive-reference`, body: { version: 1 } });
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await expect(page.locator(".tr-evidence").getByText("가상 원문 둘", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("topic-evidence-mobile.png"), fullPage: true });
  expect(state.external).toEqual([]);
});

test("Aside instructions copy the frozen source and personal writing guidance without running a job", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/requests");
  await page.getByRole("button", { name: "자세히", exact: true }).click();
  await page.getByRole("button", { name: "Aside용 작업 지침 복사" }).click();
  await expect(page.getByText("작업 지침을 복사했습니다. Aside에 붙여 넣고 받은 결과를 아래에 가져오세요.")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText);
  expect(copied).toContain("가상 원문 둘");
  expect(copied).toContain("개인 스킬 예시");
  expect(copied).toContain("예시 집필 기준");
  expect(state.writes).toEqual([]);
  expect(state.external).toEqual([]);
});

test("worker displays and copies the entire canonical text, selected evidence, brief and skill", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/worker?via=now");
  await page.getByRole("button", { name: "다음 작업 가져오기" }).click();
  await expect(page.getByText("공정: threads · 대상: 선택한 작업 제목", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "회사 정본 · v10" })).toBeVisible();
  await expect(page.getByRole("region", { name: "회사 정본", exact: true }).locator("pre")).toContainText("정본 본문 마지막");
  const evidence = page.getByRole("region", { name: "선택한 주제와 근거", exact: true }).locator("pre");
  await expect(evidence).toContainText("선택한 브리프의 핵심");
  await expect(evidence).toContainText("https://example.test/example-two");
  await expect(evidence).toContainText("일을 작게 나누면 무엇이 달라질까?");
  await page.getByRole("button", { name: "이 작업 전체 복사" }).click();
  const copied = JSON.parse(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText));
  expect(copied.target.canonical.body).toBe("정본 본문 시작\n승인한 예시와 장면을 확인한다.\n정본 본문 마지막");
  expect(copied.target.topic.reference_items[0].id).toBe("example-two");
  expect(copied.skill.body).toBe("구체적인 장면부터 쓴다.");
  expect(copied.resultFormat).toBe('{"posts":["글"]}');
  expect(state.writes.map(write => write.path)).toEqual(["worker/next"]);
  expect(state.external).toEqual([]);
});
