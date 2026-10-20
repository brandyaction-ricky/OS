import { test, expect } from "@playwright/test";

// This suite needs its isolated mock-auth server, never the normal demo or a connected deployment.
test.skip(process.env.RECORDING_TRANSPORT_QA !== "true", "Run with playwright.recording.config.ts");
const owner = "00000000-0000-4000-8000-000000000001";
const meetingId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
declare global { interface Window { recordingQa: { emit: (event: Record<string, unknown>) => void; stopped: number; started: number } } }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ owner }) => {
    localStorage.setItem("brandy-os-menu-guide-final", "seen");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
    const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: owner, exp, role: "authenticated", aud: "authenticated" })}.synthetic`;
    localStorage.setItem("sb-recording-qa-auth-token", JSON.stringify({ access_token, refresh_token: "synthetic", token_type: "bearer", expires_at: exp, expires_in: 3600, user: { id: owner, email: "qa@example.test", aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() } }));
    let emit = (event: Record<string, unknown>) => { void event; };
    window.recordingQa = { emit: event => emit(event), stopped: 0, started: 0 };
    const mediaTrack = { stop: () => { window.recordingQa.stopped++; }, addEventListener: () => {} };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => ({ getTracks: () => [mediaTrack], getAudioTracks: () => [mediaTrack] }) });
    Object.defineProperty(window, "MediaRecorder", { value: class {
      static isTypeSupported() { return true; }
      state = "inactive"; mimeType = "audio/webm";
      ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = "recording"; window.recordingQa.started++; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["synthetic audio"]) }); this.onstop?.(); }
    } });
    Object.defineProperty(window, "RTCPeerConnection", { value: class {
      connectionState = "connected";
      channel = { readyState: "open", onopen: null as null | (() => void), onmessage: null as null | ((event: { data: string }) => void), onclose: null as null | (() => void), send: () => {}, close: () => {} };
      addTrack() {}
      createDataChannel() { emit = event => this.channel.onmessage?.({ data: JSON.stringify(event) }); return this.channel; }
      async createOffer() { return { type: "offer", sdp: "v=0\r\nm=audio" }; }
      async setLocalDescription() {}
      async setRemoteDescription() { this.channel.onopen?.(); }
      close() {}
    } });
  }, { owner });
  await page.route("https://recording-qa.invalid/**", async route => {
    const profile = { id: owner, display_name: "QA", email: "qa@example.test", role: "admin", member_kind: "staff", is_active: true, finance_access: true };
    await route.fulfill({ json: route.request().url().includes("os_profiles") ? profile : { user: { id: owner } } });
  });
  const make = (id: string, title: string) => ({ id, title, description: "기존 메모", status: "active", version: 1, owner_id: owner, created_by: owner, created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:00:00Z", starts_at: "2026-10-12T00:00:00Z", attendees: [owner], metadata: { workspace: "knowledge", visibility: "team", agenda: "QA", items: [] } });
  const meetings = [make(meetingId, "합성 녹음 QA"), make(otherId, "다른 회의 QA")];
  const actor = { ownerId: owner, type: "user", role: "admin", memberKind: "staff", active: true, allowedStatuses: ["draft", "team", "canonical"] };
  const people = [{ id: owner, display_name: "QA", role: "admin", member_kind: "staff", can_approve: false }];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/live-transcription")) { await route.fulfill({ contentType: "application/sdp", body: "v=0\r\nm=audio" }); return; }
    if (path === "/api/v1/knowledge/workspace") {
      if (request.method() === "POST") {
        const input = request.postDataJSON(); const meeting = meetings.find(row => row.id === input.id)!;
        if (input.action === "meeting.save") { meeting.description = input.content; meeting.title = input.title; meeting.version++; }
        await route.fulfill({ json: { id: input.id } }); return;
      }
      await route.fulfill({ json: { actor, schemaReady: true, state: { meetings, people, documents: [], categories: [], templates: [], inbox: [], pins: [], drafts: [], versions: {}, candidates: [], proposals: [], events: [] } } }); return;
    }
    if (path === `/api/v1/knowledge/meetings/${meetingId}` || path === `/api/v1/knowledge/meetings/${otherId}`) {
      await route.fulfill({ json: { actor, people, meeting: meetings.find(row => path.endsWith(row.id)) } }); return;
    }
    await route.fulfill({ json: { members: [], checks: [], checkedAt: new Date().toISOString(), policies: [], ready: true, database: "ready", auth: "ready", records: [], documents: [], notifications: [], preferences: {}, unreadCount: 0, items: [], summary: {} } });
  });
});

async function emit(page: import("@playwright/test").Page, type: string, id: string, extra = {}) {
  await page.evaluate(event => window.recordingQa.emit(event), { type, item_id: id, ...extra });
}

test("live memo, navigation outside knowledge, original-meeting return and final speech", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/knowledge/meetings/${meetingId}`);
  await page.getByRole("button", { name: "녹음 시작", exact: true }).click();
  await page.getByRole("button", { name: "동의 확인 · 녹음 시작" }).click();
  const bar = page.getByRole("complementary", { name: "진행 중인 회의 녹음" });
  await expect(bar).toContainText("실시간 받아쓰기 연결됨");
  await emit(page, "input_audio_buffer.committed", "one", { previous_item_id: null });
  await emit(page, "conversation.item.input_audio_transcription.delta", "one", { delta: "지금 받아쓰는" });
  await expect(page.getByLabel("회의 메모 실시간 받아쓰기")).toContainText("지금 받아쓰는");
  await emit(page, "conversation.item.input_audio_transcription.completed", "one", { transcript: "지금 받아쓰는 확정 문장" });
  const editor = page.getByRole("textbox", { name: "editable markdown", exact: true });
  await expect(editor).toContainText("지금 받아쓰는 확정 문장");
  await expect(page.getByRole("main").getByText("저장됨", { exact: true }).first()).toBeVisible();
  // Use app navigation, not a full document reload (which browsers cannot keep recording through).
  await page.getByRole("button", { name: /^설정/ }).first().click();
  await page.getByRole("link", { name: "작동 상태", exact: true }).first().click();
  await expect(page).not.toHaveURL(/knowledge/);
  await expect(bar).toContainText("녹음 중");
  expect(await page.evaluate(() => window.recordingQa.stopped)).toBe(0);
  await emit(page, "input_audio_buffer.committed", "two", { previous_item_id: "one" });
  await emit(page, "conversation.item.input_audio_transcription.completed", "two", { transcript: "다른 메뉴에서 말한 문장" });
  await bar.getByRole("link").click();
  await expect(editor).toContainText("기존 메모"); await expect(editor).toContainText("다른 메뉴에서 말한 문장");
  await emit(page, "conversation.item.input_audio_transcription.completed", "two", { transcript: "중복 이벤트" });
  await expect(editor).not.toContainText("중복 이벤트");
  await emit(page, "input_audio_buffer.speech_started", "three");
  await bar.getByRole("button", { name: "녹음 종료", exact: true }).click();
  await emit(page, "input_audio_buffer.committed", "three", { previous_item_id: "two" });
  await emit(page, "conversation.item.input_audio_transcription.completed", "three", { transcript: "마지막 문장" });
  await expect(editor).toContainText("마지막 문장"); await expect(bar).toContainText("녹음 종료");
  expect(await page.evaluate(() => window.recordingQa.started)).toBe(1);
  expect(await page.evaluate(() => window.recordingQa.stopped)).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await bar.screenshot({ path: test.info().outputPath("recording-bar-mobile.png") });
  expect(errors).toEqual([]);
});
