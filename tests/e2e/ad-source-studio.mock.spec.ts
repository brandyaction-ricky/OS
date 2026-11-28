import { expect, test, type Page } from "@playwright/test";
import { getSharp } from "next/dist/server/image-optimizer";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { adSourcePlan, type AdSourceBundle, type AdSourceInput } from "../../lib/ad-source-studio";

// Fictional local authentication; no live Supabase/OpenAI traffic or production data.
test.skip(process.env.AD_SOURCE_MOCK_E2E !== "true", "Requires the local mock-auth server.");
async function fixture(page: Page, failSecond = false) {
  const owner = crypto.randomUUID(), expires = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") + "." + Buffer.from(JSON.stringify({ sub: owner, role: "authenticated", exp: expires })).toString("base64url") + ".fixture";
  await page.addInitScript(({ owner, token, expires }) => {
    localStorage.setItem("sb-image-ui-test-auth-token", JSON.stringify({ access_token: token, refresh_token: "fixture", expires_at: expires,
      expires_in: 3600, token_type: "bearer", user: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
  }, { owner, token, expires });
  const png = await getSharp(undefined)({ create: { width: 24, height: 30, channels: 3, background: "#356d87" } }).png().toBuffer();
  const records = new Map<string, AdSourceBundle>(), calls: string[] = [], uploads: Buffer[] = [], inputs: AdSourceInput[] = [];
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let failed = false, inFlight = 0, maxInFlight = 0;
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === "image-ui-test.supabase.co" && url.pathname === "/rest/v1/os_profiles") return route.fulfill({ json: { id: owner, role: "admin", display_name: "시험 담당자", is_active: true } });
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.startsWith("/fixture-")) return route.fulfill({ contentType: "image/png", body: png });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/v1/content/youtube/channel-styles") return route.fulfill({ json: { styles: [], version: 0, purposes: [] } });
    if (url.pathname === "/api/v1/content/ad-sources") {
      if (req.method() === "POST") {
        const input = req.postDataJSON() as AdSourceInput; inputs.push(input);
        const project: AdSourceBundle = { id: crypto.randomUUID(), title: input.mode === "image" ? input.message : input.script.split("\n")[0], version: 1, updatedAt: new Date().toISOString(), input, items: adSourcePlan(input), references: [], activeUntil: null };
        records.set(project.id, project); return route.fulfill({ status: 201, json: project });
      }
      return route.fulfill({ json: { projects: [...records.values()].map(p => ({ id: p.id, title: p.title, updatedAt: p.updatedAt, mode: p.input.mode, done: p.items.filter(item => item.status === "done").length, total: p.items.length })) } });
    }
    if (url.pathname.startsWith("/api/v1/content/ad-sources/")) {
      const parts = url.pathname.split("/"), project = records.get(parts[5])!;
      expect(project).toBeTruthy();
      if (parts[6] === "references") {
        uploads.push(req.postDataBuffer()!); expect(req.headers()["content-type"]).toContain("multipart/form-data");
        expect(uploads.at(-1)!.includes(png)).toBeTruthy();
        project.references.push({ path: "fixture-reference.png", w: 24, h: 30, url: "/fixture-reference.png" }); project.version++;
      }
      if (parts[6] === "generate") {
        const body = req.postDataJSON(); expect(body.version).toBe(project.version); expect(project.references.length).toBe(project.input.referenceCount);
        const item = project.items.find(item => item.id === body.itemId)!;
        expect(item.status).not.toBe("done"); calls.push(item.id); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        item.attempts++; project.version += 2;
        if (failSecond && item.id === "source-2" && !failed) {
          failed = true; item.status = "failed"; item.error = "시험용 생성 중단"; inFlight--;
          return route.fulfill({ status: 503, json: { error: { code: "FIXTURE_FAILURE", message: item.error } } });
        }
        item.status = "done"; item.error = undefined; item.asset = { path: `fixture-${item.id}.png`, w: 1080, h: 1350, url: `/fixture-${item.id}.png` }; inFlight--;
      }
      return route.fulfill({ json: project });
    }
    if (url.pathname.endsWith("/menu-access")) return route.fulfill({ json: { policies: [], ready: true } });
    return route.fulfill({ json: { projects: [], items: [], topics: [], members: [], records: [], channels: [], connections: [], policies: [], jobs: [], canConfirm: true } });
  });
  return { png, inputs, calls, records, uploads, errors, maxInFlight: () => maxInFlight };
}

test("reference + message + appeal creates multiple images, retries only unfinished items, reopens and downloads ZIP", async ({ page }, testInfo) => {
  const f = await fixture(page, true);
  await page.goto("/content/projects?platform=ad");
  const studio = page.getByRole("region", { name: "광고 소재 만들기" });
  await expect(studio.getByRole("heading", { name: "어떤 소재가 필요한가요?" })).toBeVisible();
  await studio.getByLabel("광고에 넣을 메시지·내용").fill("시험용 제품을 만나보세요");
  await studio.getByLabel("강조할 소구").fill("매일 쓰기 편한 구성");
  await studio.getByLabel("참고 이미지 선택", { exact: true }).setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: f.png });
  await studio.screenshot({ path: testInfo.outputPath("image-input.png") });
  await studio.getByRole("button", { name: "이미지 소재 3개 만들기" }).click();
  await expect(studio.getByRole("alert")).toContainText("시험용 생성 중단");
  await expect(studio.getByText("이미지 소재 · 1/3개 완료", { exact: true })).toBeVisible();
  expect(f.calls).toEqual(["source-1", "source-2"]); expect(f.uploads).toHaveLength(1);
  await page.reload();
  await expect(studio.getByRole("button", { name: "남은 소재 이어 만들기" })).toBeEnabled();
  expect(f.calls).toEqual(["source-1", "source-2"]);
  await studio.getByRole("button", { name: "남은 소재 이어 만들기" }).click();
  await expect(studio.getByText("이미지 소재 · 3/3개 완료", { exact: true })).toBeVisible();
  expect(f.calls).toEqual(["source-1", "source-2", "source-2", "source-3"]); expect(f.maxInFlight()).toBe(1);
  await expect(studio.getByRole("img", { name: /생성 결과/ })).toHaveCount(3);
  const pendingDownload = page.waitForEvent("download");
  await studio.getByRole("button", { name: "완료된 3개 ZIP" }).click();
  const download = await pendingDownload;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(Object.keys(zip.files).sort()).toEqual(["scene-guide.txt", "source-1.png", "source-2.png", "source-3.png"]);
  await studio.screenshot({ path: testInfo.outputPath("image-results.png") });
  expect(f.errors).toEqual([]);
});

test("video script preserves narration and scene directions, creates one image per scene and stays usable on mobile", async ({ page }, testInfo) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/content/projects?platform=ad");
  const studio = page.getByRole("region", { name: "광고 소재 만들기" });
  await studio.getByRole("button", { name: "영상 소스 스크립트에 맞는 장면 이미지 만들기" }).click();
  await studio.getByLabel("영상 스크립트").fill("바쁜 아침을 시작합니다.\n책상 위에 제품을 놓습니다.");
  await studio.getByLabel("장면 1 화면 설명").fill("창가에서 준비하는 사람의 뒷모습");
  await studio.getByLabel("장면 2 화면 설명").fill("제품이 중앙에 놓인 책상 클로즈업");
  await expect(studio.getByLabel("소재 비율")).toHaveValue("9:16");
  await studio.screenshot({ path: testInfo.outputPath("video-input-mobile.png") });
  await studio.getByRole("button", { name: "장면 이미지 2개 만들기" }).click();
  await expect(studio.getByText("영상용 장면 이미지 · 2/2개 완료", { exact: true })).toBeVisible();
  expect(f.inputs[0]).toMatchObject({ mode: "video", script: "바쁜 아침을 시작합니다.\n책상 위에 제품을 놓습니다.", visuals: ["창가에서 준비하는 사람의 뒷모습", "제품이 중앙에 놓인 책상 클로즈업"] });
  expect([...f.records.values()][0].items.map(item => item.narration)).toEqual(["바쁜 아침을 시작합니다.", "책상 위에 제품을 놓습니다."]);
  expect(await studio.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.reload();
  await expect(studio.getByText("영상용 장면 이미지 · 2/2개 완료", { exact: true })).toBeVisible();
  expect(f.calls).toHaveLength(2);
  await studio.getByRole("button", { name: "입력 바꿔 새로 만들기" }).click();
  await expect(studio.getByLabel("장면 2 화면 설명")).toHaveValue("제품이 중앙에 놓인 책상 클로즈업");
  expect(f.errors).toEqual([]);
});

test("oversized scene lists and invalid reference types do not create requests; legacy planning remains accessible", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/content/projects?platform=ad");
  const studio = page.getByRole("region", { name: "광고 소재 만들기" });
  await studio.getByLabel("참고 이미지 선택", { exact: true }).setInputFiles({ name: "not-image.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
  await expect(studio.getByRole("alert")).toContainText("PNG 또는 JPG");
  await studio.getByRole("button", { name: "영상 소스 스크립트에 맞는 장면 이미지 만들기" }).click();
  await studio.getByLabel("영상 스크립트").fill(Array(13).fill("장면 대사").join("\n"));
  await expect(studio.getByRole("button", { name: "장면 이미지 13개 만들기" })).toBeDisabled();
  expect(f.inputs).toHaveLength(0);
  await page.getByRole("button", { name: "단계별 광고 기획" }).click();
  await expect(page.locator(".ad-setup")).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("ad source endpoints require authentication before reading files or generating images", async ({ request }) => {
  const id = "22222222-2222-4222-8222-222222222222";
  for (const path of ["", `/${id}`]) expect((await request.get(`/api/v1/content/ad-sources${path}`)).status()).toBe(401);
  for (const path of ["", `/${id}/generate`, `/${id}/references`]) expect((await request.post(`/api/v1/content/ad-sources${path}`, { data: {} })).status()).toBe(401);
});
