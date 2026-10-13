import { defineConfig, devices } from "@playwright/test";

process.env.RECORDING_TRANSPORT_QA = "true";

// Isolated, credential-free browser transport QA. All API/auth/audio are synthetic.
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "meeting-recording.spec.ts", workers: 1,
  use: { baseURL: "http://127.0.0.1:3102", ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3102", url: "http://127.0.0.1:3102", timeout: 120_000,
    env: { NEXT_PUBLIC_DEMO_MODE: "false", NEXT_PUBLIC_SUPABASE_URL: "https://recording-qa.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-browser-test-key" },
  },
});
