import { expect, test } from "@playwright/test";

test("copy lineage write remains closed in credential-free local demo", async ({ request }) => {
  const response = await request.post("/api/v1/content/copy-lineage", { data: {
    kind: "decision", sourceId: "11111111-1111-4111-8111-111111111111", expectedSourceVersion: 1,
    decisionAt: "2026-09-04", evidenceUrl: "https://example.com/decision",
    title: "Synthetic title", thumbnailCopy: "Synthetic copy", note: "",
  } });
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual({ error: { message: "DEV 시험 환경에서만 사용할 수 있습니다." } });
});
