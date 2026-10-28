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
const WEAK = "00000000-0000-4000-8000-000000000014";
const LEGACY = "00000000-0000-4000-8000-000000000015";
const CREATED = "00000000-0000-4000-8000-000000000013";
const TOPIC = "00000000-0000-4000-8000-000000000021";
const ITEM_IDS: Record<string, string> = { threads: "00000000-0000-4000-8000-000000000041", card: "00000000-0000-4000-8000-000000000042", shorts: "00000000-0000-4000-8000-000000000043" };
const JOB = "00000000-0000-4000-8000-000000000031";
const AT = "2026-01-15T03:00:00.000Z";

function reference(id: string, title: string): ThreadsReferenceItem {
  return { id, title, koreanTitle: id === "example-one" ? "계획을 줄이면 시작이 쉬워지는 이유" : "한 가지 일을 마치는 연습",
    summary: "작은 계획을 끝낸 경험을 통해 시작할 때의 부담과 실제 행동의 차이를 설명한다.",
    suggestedTopic: id === "example-one" ? "계획의 크기와 시작 비용은 어떻게 연결될까?" : "한 가지 일을 마치려면 무엇을 줄여야 할까?",
    relevanceNote: "계획은 많지만 실행을 시작하기 어려운 독자의 일상 고민과 연결된다.",
    audienceNote: "댓글에서 여러 독자가 할 일을 줄인 날 실제로 시작하기 쉬웠다고 말했고, 남은 일의 우선순위를 묻는 질문이 반복됐다.",
    url: `https://example.test/${id}`, platform: "threads", author: "예시 작성자", publishedAt: "2026-01-14", observedAt: AT,
    metrics: { views: { value: 120000, verified: true }, likes: { value: 0, verified: true }, comments: { value: 10, verified: true }, reposts: { value: null, verified: false } },
    readScope: "full", readNote: "예시 본문 전체와 댓글의 질문, 화면의 반응 표시를 직접 확인함.", capturedBy: "human", scene: "예시 작성자가 한 번에 한 가지 일을 마쳤다.",
    readerQuestion: "일을 작게 나누면 무엇이 달라질까?", addedPerspective: "계획 크기와 시작 비용을 함께 살펴본다." };
}
function record(id: string, title: string, metadata: Record<string, unknown>): OsRecord {
  return { id, title, metadata, record_type: "content_topic", description: "", status: "draft", stage: "candidate", priority: "normal", brand: "", team: "", owner_id: OWNER,
    assignee_id: null, parent_id: null, due_date: null, starts_at: null, ends_at: null, progress: 0, metric_target: null, metric_current: null, metric_unit: "", amount: null, currency: "KRW",
    source_url: null, tags: [], version: 1, created_by: OWNER, updated_by: OWNER, created_at: AT, updated_at: AT, archived_at: null };
}
function importedTopic() {
  return record(TOPIC, "한 가지 일을 마치려면 무엇을 줄여야 할까?", {
    source: "reference", editorial_workflow: "threads_reference_v1", brief: {}, channels: [],
    reference_items: [reference("example-two", "가상 원문 둘")],
  });
}

async function mockWorkspace(page: Page, noRecommendations = false) {
  const first = reference("example-one", "The cost of a big plan"), second = reference("example-two", "가상 원문 둘");
  const weak: ThreadsReferenceItem = { ...reference("example-weak", "A quiet example"), platform: "substack", koreanTitle: "작은 반응에 머문 예시", metrics: { ...first.metrics, views: { value: null, verified: false }, likes: { value: 6, verified: true }, comments: { value: 1, verified: true } } };
  const legacy = { ...reference("example-legacy", "Earlier collected example"), koreanTitle: "", summary: "", suggestedTopic: "", audienceNote: "", relevanceNote: "", metrics: { ...first.metrics, views: { value: null, verified: false } } };
  // Missing fields represent records collected before the quality policy existed.
  const { koreanTitle: _koreanTitle, summary: _summary, suggestedTopic: _suggestedTopic, audienceNote: _audienceNote, relevanceNote: _relevanceNote, ...legacyStored } = legacy;
  void _koreanTitle; void _summary; void _suggestedTopic; void _audienceNote; void _relevanceNote;
  const state = {
    references: [
      ...noRecommendations ? [] : [record(FIRST, first.title, { kind: "threads_reference", reference_items: [first] }), record(SECOND, second.title, { kind: "threads_reference", reference_items: [second] })],
      record(WEAK, weak.title, { kind: "threads_reference", reference_items: [weak] }), record(LEGACY, legacy.title, { kind: "threads_reference", reference_items: [legacyStored] }),
    ],
    topics: [] as OsRecord[], items: [] as OsRecord[], queuedJobs: [] as OsRecord[], startFailures: 0,
    writes: [] as { path: string; body: Record<string, unknown> }[], external: [] as string[],
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
      if (path === `topics/${TOPIC}` && request.method() === "PATCH") {
        const current = state.topics.find(topic => topic.id === TOPIC)!;
        expect(body.expectedVersion).toBe(current.version);
        const topic = { ...current, version: current.version + 1, stage: String(body.stage), metadata: { ...current.metadata, ...(body.metadata as Record<string, unknown>) } };
        state.topics = state.topics.map(row => row.id === TOPIC ? topic : row);
        return json({ record: topic });
      }
      if (path === `topics/${TOPIC}/start`) {
        if (state.startFailures > 0) {
          state.startFailures -= 1;
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "시험용 제작 오류 — 다시 시도해 주세요." } }) });
        }
        const current = state.topics.find(topic => topic.id === TOPIC)!;
        expect(body.version).toBe(current.version);
        const channelOptions = body.channels as Record<string, { due?: string }>;
        const channels = Object.keys(channelOptions);
        const topic = { ...current, stage: "confirmed", version: current.version + 1, metadata: { ...current.metadata, brief: body.brief, channels } };
        const items = channels.map(channel => ({ ...record(ITEM_IDS[channel], topic.title, {
          space: "personal", channel, step: 0, pages: [], cuts: [], posts: [], ...(body.teamThreads && channel === "threads" ? { shared: "team" } : {}),
        }), record_type: "content_publish", stage: "making", parent_id: TOPIC, due_date: channelOptions[channel].due ?? null } as OsRecord));
        expect(state.items).toHaveLength(0);
        state.topics = state.topics.map(row => row.id === TOPIC ? topic : row);
        state.items.push(...items);
        return json({ topic, items });
      }
      if (path === "jobs" && body.proc === "brief" && body.targetId === TOPIC) {
        const job: OsRecord = { ...record("00000000-0000-4000-8000-000000000032", "요청한 기획 초안", { proc: body.proc, targetId: body.targetId, jobNo: 2 }), record_type: "ai_job", status: "backlog" };
        state.queuedJobs.push(job);
        return json({ job });
      }
      if (path === `topics/${SECOND}/archive-reference`) {
        state.references = state.references.filter(row => row.id !== SECOND); return json({ archived: true });
      }
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { message: "예상하지 않은 변경 요청" } }) });
    }
    if (path === "references") return json({ references: state.references, collectionContext: { canonicalUrl: "https://example.test/canonical", canonicalTitle: "예시 쓰레드 정본", canonicalVersion: 2 } });
    if (path === "worker/state") return json({ browser: { id: "fixture-browser", name: "시험 브라우저", registeredAt: AT }, rules: { per_run: 3, daily_max: 10, long_only_now: true }, run: null, pending: 1, todayTaken: 0 });
    if (path === "topics") return json({ topics: state.topics });
    if (path === "items") return json({ items: state.items });
    if (path === "review-log") return json({ reviews: [] });
    if (/^items\/[^/]+\/comments$/.test(path)) return json({ comments: [] });
    if (path === "reviewers") return json({ reviewers: [], canReview: false, canManage: false });
    if (path === "jobs") return json({ jobs: [record(JOB, "가상 브리프 작업", { proc: "brief", targetId: TOPIC, jobNo: 1 }), ...state.queuedJobs].map(row => ({ ...row, record_type: "ai_job", status: "backlog" })) });
    if (path === `jobs/${JOB}/instructions`) return json({ target: { topic: { reference_items: [second] }, canonical: { title: "예시 집필 기준", version: 2, body: "원문의 장면과 독자의 질문을 이어 쓴다." } }, instructions: "확인한 근거만 사용한다.", skill: "개인 스킬 예시", resultFormat: { one: "한 줄 주제" } });
    if (path === "browsers") return json({ browsers: [] });
    if (path === "runs") return json({ runs: [], silent: false });
    return json({ records: [], notifications: [], requests: [], policies: [], ok: true });
  });
  return state;
}

test("qualified Korean references propose a topic and preserve human edits until explicitly replaced", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/references");
  await expect(page.getByRole("button", { name: "전체 4개", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "추천 후보 2개", exact: true }).click();
  await expect(page.locator(".tr-reference")).toHaveCount(2);
  const first = page.locator(".tr-reference").filter({ hasText: "The cost of a big plan" });
  await expect(first.getByRole("heading", { name: "계획을 줄이면 시작이 쉬워지는 이유" })).toBeVisible();
  await expect(first.locator(".tr-original-title")).toHaveText("원제: The cost of a big plan");
  await expect(first.locator(".tr-summary")).toContainText("작은 계획을 끝낸 경험");
  await page.getByLabel("계획을 줄이면 시작이 쉬워지는 이유 선택", { exact: true }).check();
  const topicName = page.getByLabel("주제 후보 이름", { exact: true });
  await expect(topicName).toHaveValue("계획의 크기와 시작 비용은 어떻게 연결될까?");
  await page.screenshot({ path: testInfo.outputPath("references-korean-recommendations.png"), fullPage: true });
  await topicName.fill("사람이 정한 내부 기획 이름");
  await page.getByLabel("한 가지 일을 마치는 연습 선택", { exact: true }).check();
  await expect(topicName).toHaveValue("사람이 정한 내부 기획 이름");
  await page.getByLabel("계획을 줄이면 시작이 쉬워지는 이유 선택", { exact: true }).uncheck();
  await expect(topicName).toHaveValue("사람이 정한 내부 기획 이름");
  await page.getByRole("button", { name: "제안 사용: 한 가지 일을 마치려면 무엇을 줄여야 할까?", exact: true }).click();
  await expect(topicName).toHaveValue("한 가지 일을 마치려면 무엇을 줄여야 할까?");
  await page.getByRole("button", { name: "선택 해제", exact: true }).click();
  await expect(topicName).toHaveCount(0);
  await page.getByLabel("한 가지 일을 마치는 연습 선택", { exact: true }).check();
  await expect(topicName).toHaveValue("한 가지 일을 마치려면 무엇을 줄여야 할까?");
  await page.getByRole("button", { name: "주제 후보로 가져오기" }).click();
  await expect(page).toHaveURL(new RegExp(`/automation/topics\\?sel=${TOPIC}`));
  expect(state.writes[0].body.referenceIds).toEqual([SECOND]);
  expect(state.writes[0].body.title).toBe("한 가지 일을 마치려면 무엇을 줄여야 할까?");
  await expect(page.locator(".tr-evidence")).not.toHaveAttribute("open");
  await page.getByText("선택한 참고 자료 1개", { exact: true }).click();
  await expect(page.locator(".tr-evidence").getByRole("heading", { name: "한 가지 일을 마치는 연습", exact: true })).toBeVisible();
  await expect(page.locator(".tr-evidence").getByText("The cost of a big plan", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("쓰레드", { exact: true })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.goto("/automation/references");
  await page.locator(".tr-reference").filter({ hasText: "한 가지 일을 마치는 연습" }).getByRole("button", { name: "보관", exact: true }).click();
  await expect(page.locator(".tr-reference")).toHaveCount(3);
  expect(state.writes[1]).toEqual({ path: `topics/${SECOND}/archive-reference`, body: { version: 1 } });
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await page.getByText("선택한 참고 자료 1개", { exact: true }).click();
  await expect(page.locator(".tr-evidence").getByRole("heading", { name: "한 가지 일을 마치는 연습", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("topic-evidence-mobile.png"), fullPage: true });
  expect(state.external).toEqual([]);
});

test("reference planning starts with a draft and preserves edited fields, intentional blanks and channel choices after saving", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.topics.push(importedTopic());
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await expect(page.getByLabel("한 줄 주제", { exact: true })).toHaveValue(state.topics[0].title);
  await expect(page.getByLabel("누구에게", { exact: true })).toHaveValue("계획은 많지만 실행을 시작하기 어려운 독자의 일상 고민과 연결된다.");
  await expect(page.getByLabel("핵심 메시지", { exact: true })).toHaveValue("계획 크기와 시작 비용을 함께 살펴본다.");
  await expect(page.getByLabel("근거·자료", { exact: true })).toHaveValue(/https:\/\/example\.test\/example-two/);
  await expect(page.getByLabel("근거·자료", { exact: true })).toHaveValue(/읽은 범위: 전체 읽음/);
  await expect(page.getByLabel("쓰레드", { exact: true })).toBeChecked();
  await expect(page.locator(".ca-v07-board")).toHaveCount(0);
  await expect(page.locator(".tr-evidence")).not.toHaveAttribute("open");
  expect(state.writes).toEqual([]);

  await page.getByLabel("한 줄 주제", { exact: true }).fill("사람이 다시 정한 질문");
  await page.getByLabel("누구에게", { exact: true }).fill("");
  await page.getByLabel("주의할 표현", { exact: true }).fill("");
  await page.getByLabel("쓰레드", { exact: true }).uncheck();
  await page.getByRole("button", { name: "기획만 저장", exact: true }).click();
  await expect.poll(() => state.topics[0].stage).toBe("brief");
  await expect(page.getByRole("button", { name: "기획만 저장", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("한 줄 주제", { exact: true })).toHaveValue("사람이 다시 정한 질문");
  await expect(page.getByLabel("누구에게", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("주의할 표현", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("쓰레드", { exact: true })).not.toBeChecked();
  expect(state.writes.map(write => write.path)).toEqual([`topics/${TOPIC}`]);
  expect(state.items).toEqual([]);
  expect(state.external).toEqual([]);
});

test("confirming a Threads plan opens its draft and a started topic resumes the same item without running AI or publishing", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.topics.push(importedTopic());
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await page.getByLabel("핵심 메시지", { exact: true }).fill("원고에서 끝까지 답할 관점을 사람이 확인했다.");
  await page.getByLabel("쓰레드 마감", { exact: true }).fill("2026-12-01");
  await page.getByRole("button", { name: "기획 확인하고 쓰레드 집필로 이동", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/automation/threads\\?sel=${ITEM_IDS.threads}`));
  await expect(page.getByRole("button", { name: "내 AI로 쓰레드 글 쓰기", exact: true })).toBeVisible();
  expect(state.items).toHaveLength(1);
  expect(state.items[0].status).toBe("draft");
  expect(state.items[0].metadata.posts).toEqual([]);
  expect(state.items[0].due_date).toBe("2026-12-01");
  expect((state.topics[0].metadata.brief as Record<string, string>).message).toBe("원고에서 끝까지 답할 관점을 사람이 확인했다.");
  expect(state.writes.map(write => write.path)).toEqual([`topics/${TOPIC}/start`]);

  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await expect(page.getByLabel("한 줄 주제", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기획만 저장", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "쓰레드 집필 계속하기", exact: true })).toHaveAttribute("href", `/automation/threads?sel=${ITEM_IDS.threads}`);
  await page.getByRole("link", { name: "쓰레드 집필 계속하기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/automation/threads\\?sel=${ITEM_IDS.threads}`));
  expect(state.writes.map(write => write.path)).toEqual([`topics/${TOPIC}/start`]);
  expect(state.external).toEqual([]);
});

test("missing planning fields block production and a failed start preserves edits for a safe retry", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.topics.push(importedTopic());
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await page.getByLabel("핵심 메시지", { exact: true }).fill("");
  await page.getByRole("button", { name: "기획 확인하고 쓰레드 집필로 이동", exact: true }).click();
  await expect(page.locator(".ca-v07-topic-editor").getByRole("alert")).toContainText("핵심 메시지");
  expect(state.writes).toEqual([]);

  await page.getByLabel("핵심 메시지", { exact: true }).fill("실패해도 남아 있어야 하는 수정한 관점");
  await page.getByLabel("주의할 표현", { exact: true }).fill("사람이 확인한 주의사항");
  state.startFailures = 1;
  await page.getByRole("button", { name: "기획 확인하고 쓰레드 집필로 이동", exact: true }).click();
  await expect(page.locator(".ca-v07-topic-editor").getByRole("alert")).toContainText("시험용 제작 오류");
  await expect(page.getByLabel("핵심 메시지", { exact: true })).toHaveValue("실패해도 남아 있어야 하는 수정한 관점");
  await expect(page.getByLabel("주의할 표현", { exact: true })).toHaveValue("사람이 확인한 주의사항");
  expect(state.items).toHaveLength(0);
  await page.getByRole("button", { name: "기획 확인하고 쓰레드 집필로 이동", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/automation/threads\\?sel=${ITEM_IDS.threads}`));
  expect(state.items).toHaveLength(1);
  expect(state.writes.map(write => write.path)).toEqual([`topics/${TOPIC}/start`, `topics/${TOPIC}/start`]);
  expect((state.writes[1].body.brief as Record<string, string>).message).toBe("실패해도 남아 있어야 하는 수정한 관점");
  expect(state.external).toEqual([]);
});

test("optional AI planning saves the edited brief before confirmation and cancelling does not queue a job", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.topics.push(importedTopic());
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await page.getByLabel("핵심 메시지", { exact: true }).fill("AI에게 전달할 사람이 수정한 관점");
  await page.getByText("기획을 더 다듬고 싶다면", { exact: true }).click();
  await page.getByRole("button", { name: "내 AI로 기획 메모 쓰기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "내 AI로 보내기", exact: true });
  await expect(dialog).toBeVisible();
  expect((state.topics[0].metadata.brief as Record<string, string>).message).toBe("AI에게 전달할 사람이 수정한 관점");
  expect(state.writes.map(write => write.path)).toEqual([`topics/${TOPIC}`]);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("핵심 메시지", { exact: true })).toHaveValue("AI에게 전달할 사람이 수정한 관점");
  expect(state.queuedJobs).toHaveLength(0);

  await page.getByLabel("핵심 메시지", { exact: true }).fill("취소 후 한 번 더 고친 관점");
  await page.getByRole("button", { name: "내 AI로 기획 메모 쓰기", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "대기열에 두기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((state.topics[0].metadata.brief as Record<string, string>).message).toBe("취소 후 한 번 더 고친 관점");
  expect(state.writes.map(write => write.path)).toEqual([`topics/${TOPIC}`, `topics/${TOPIC}`, "jobs"]);
  expect(state.writes[2].body).toMatchObject({ proc: "brief", targetId: TOPIC, rush: false });
  expect(state.queuedJobs).toHaveLength(1);
  expect(state.items).toHaveLength(0);
  expect(state.external).toEqual([]);
});

test("multiple production channels stay on the plan with separate resume links", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.topics.push(importedTopic());
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  await page.getByLabel("카드뉴스", { exact: true }).check();
  await page.getByRole("button", { name: "기획 확인하고 제작 항목 만들기", exact: true }).click();
  await expect(page.getByRole("link", { name: "카드뉴스 제작 계속하기", exact: true })).toHaveAttribute("href", `/automation/cardnews?sel=${ITEM_IDS.card}`);
  await expect(page.getByRole("link", { name: "쓰레드 집필 계속하기", exact: true })).toHaveAttribute("href", `/automation/threads?sel=${ITEM_IDS.threads}`);
  await expect(page).toHaveURL(new RegExp(`/automation/topics\\?sel=${TOPIC}`));
  expect(state.items).toHaveLength(2);
  expect(state.writes.map(write => write.path)).toEqual([`topics/${TOPIC}/start`]);
  expect(state.external).toEqual([]);
});

test("mobile topic planning keeps native controls compact and its next action visible without horizontal scrolling", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  state.topics.push(importedTopic());
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/automation/topics?sel=${TOPIC}`);
  const checkbox = page.getByLabel("쓰레드", { exact: true });
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveCSS("width", "18px");
  await expect(checkbox).toHaveCSS("height", "18px");
  const next = page.getByRole("button", { name: "기획 확인하고 쓰레드 집필로 이동", exact: true });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  const nextBounds = await next.boundingBox();
  expect(nextBounds?.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("topic-planning-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("topic-planning-desktop.png"), fullPage: true });
  expect(state.writes).toEqual([]);
  expect(state.external).toEqual([]);
});

test("low-reaction and pending references remain selectable with their status visible", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/references");
  await page.getByRole("button", { name: "내용 참고 1개", exact: true }).click();
  const weak = page.locator(".tr-reference");
  await expect(weak).toHaveCount(1);
  await expect(weak.getByRole("checkbox")).toBeEnabled();
  await expect(weak.locator(".tr-quality")).toContainText("좋아요 100개");
  await expect(weak.locator(".tr-pick-status")).toContainText("선택 가능");
  await weak.getByText("원문·반응 근거 보기", { exact: true }).click();
  await expect(weak.locator(".tr-metrics dd").nth(1)).toHaveText("6");
  await expect(weak.locator(".tr-metrics dd").nth(2)).toHaveText("1");
  await page.screenshot({ path: testInfo.outputPath("weak-content-only.png"), fullPage: true });
  await weak.getByRole("checkbox").check();
  await expect(page.getByText("1개 선택됨", { exact: true })).toBeVisible();
  await weak.getByRole("checkbox").uncheck();
  await expect(page.locator(".tr-selection")).toHaveCount(0);
  await page.getByRole("button", { name: "검증 대기 1개", exact: true }).click();
  await expect(page.locator(".tr-reference").getByRole("checkbox")).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator(".tr-reference").getByRole("checkbox").check();
  await expect(page.getByText("1개 선택됨", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await expect(page.locator(".tr-reference").getByRole("link", { name: "선택한 자료로 주제 만들기 ↓" })).toBeVisible();
  await page.locator(".tr-reference").getByRole("link", { name: "선택한 자료로 주제 만들기 ↓" }).click();
  await page.getByLabel("주제 후보 이름", { exact: true }).fill("내가 선택한 주제");
  await expect(page.locator(".tr-reference")).toContainText("Earlier collected example");
  await expect(page.locator(".tr-reference")).toContainText("한국어 내용 제목 확인 필요");
  await page.getByRole("button", { name: "전체 4개", exact: true }).click();
  await expect(page.locator(".tr-reference")).toHaveCount(4);
  await page.getByRole("button", { name: "주제 후보로 가져오기" }).click();
  await expect(page).toHaveURL(new RegExp(`/automation/topics\\?sel=${TOPIC}`));
  expect(state.writes[0].body.referenceIds).toEqual([LEGACY]);
  expect(state.external).toEqual([]);
});

test("zero recommendations is an honest empty state and collection instructions require qualified candidates", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page, true);
  await page.goto("/automation/references");
  await page.getByRole("button", { name: "추천 후보 0개", exact: true }).click();
  await expect(page.locator(".ca-v07-empty")).toContainText("추천 후보 0개");
  await expect(page.locator(".ca-v07-empty")).toContainText("수를 채울 필요는 없습니다");
  await expect(page.locator(".tr-workspace").getByRole("alert")).toHaveCount(0);
  await page.getByText("Aside에 원문 조사 맡기기", { exact: true }).click();
  await page.getByLabel("이번에 살펴볼 주제·범위", { exact: true }).fill("작은 계획의 실제 장면");
  await expect(page.getByRole("combobox", { name: "추천 후보 수", exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "Aside 조사 지침 복사" }).click();
  const collection = await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText);
  for (const text of ["https://example.test/canonical", "작은 계획의 실제 장면", "최대 3개", "100,000", "100개 이상", "5개 이상", "중앙값의 2배", "후보 0개도 정상", "한국어 내용 제목", "suggestedTopic", "의미 있는 댓글을 직접 읽어", "수를 채우기 위해 약한 글을 추천하지", "자동으로 주제를 선택·승격", "수집함에 등록"]) expect(collection).toContain(text);
  await page.screenshot({ path: testInfo.outputPath("zero-recommendations.png"), fullPage: true });
  await page.getByRole("button", { name: "전체 2개", exact: true }).click();
  await expect(page.locator(".tr-reference")).toHaveCount(2);
  expect(state.writes).toEqual([]);
  expect(state.external).toEqual([]);
});

test("incomplete evidence may be saved and comparison draft input is not discarded", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/automation/references");
  await page.getByRole("button", { name: "+ 원문 등록" }).click();
  await page.getByLabel("원문 제목", { exact: true }).fill("직접 등록한 가상 원문");
  await page.getByLabel("한국어 내용 제목", { exact: true }).fill("아직 비교 근거를 모으는 글");
  await page.getByLabel("원문 URL", { exact: true }).fill("https://example.test/new-reference");
  await page.getByRole("combobox", { name: "플랫폼", exact: true }).selectOption("substack");
  await page.getByRole("combobox", { name: "읽은 범위", exact: true }).selectOption("partial");
  await page.getByRole("combobox", { name: "좋아요 확인", exact: true }).selectOption("verified");
  await page.getByLabel("좋아요 수", { exact: true }).fill("0");
  await page.getByRole("button", { name: "+ 비교 글 추가", exact: true }).click();
  const comparisonUrl = page.getByLabel("비교 글 1 URL", { exact: true });
  await comparisonUrl.fill("https://example.test/comparison-one");
  await page.getByLabel("비교 글 1 좋아요", { exact: true }).fill("작성 중");
  await page.getByRole("button", { name: "내 참고 자료에 저장" }).click();
  await expect(page.locator(".tr-workspace").getByRole("alert")).toContainText("작성 중인 내용은 그대로 남아 있습니다");
  await expect(comparisonUrl).toHaveValue("https://example.test/comparison-one");
  await expect(page.getByLabel("비교 글 1 좋아요", { exact: true })).toHaveValue("작성 중");
  expect(state.writes).toEqual([]);
  await page.getByLabel("비교 글 1 좋아요", { exact: true }).fill("24");
  await page.getByLabel("비교 글 1 게시일", { exact: true }).fill("2026-01-10");
  await page.getByRole("button", { name: "내 참고 자료에 저장" }).click();
  const savedItem = (state.writes[0].body.reference_items as ThreadsReferenceItem[])[0];
  expect(savedItem.metrics.likes).toEqual({ value: 0, verified: true });
  expect(savedItem.metrics.views).toEqual({ value: null, verified: false });
  expect(savedItem.capturedBy).toBe("human");
  expect(savedItem.koreanTitle).toBe("아직 비교 근거를 모으는 글");
  expect(savedItem.comparison?.posts).toEqual([{ url: "https://example.test/comparison-one", likes: 24, publishedAt: "2026-01-10" }]);
  await page.getByRole("button", { name: "내용 참고 2개", exact: true }).click();
  await expect(page.locator(".tr-reference").filter({ hasText: "아직 비교 근거를 모으는 글" }).getByRole("checkbox")).toBeEnabled();
  expect(state.writes).toHaveLength(1);
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
