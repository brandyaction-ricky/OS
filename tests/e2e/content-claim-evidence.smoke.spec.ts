import { expect, test } from "@playwright/test";

test("claim evidence write remains closed in credential-free local demo", async ({ request }) => {
  const response = await request.post("/api/v1/content/claim-evidence", { data: {} });
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual({ error: { message: "DEV 시험 환경에서만 사용할 수 있습니다." } });
});
