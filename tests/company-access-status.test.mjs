import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("company settings loads the Telegram approval state shown in its access panel", () => {
  const source = readFileSync(new URL("../components/settings-workspaces.tsx", import.meta.url), "utf8");

  assert.match(source, /\(page === "company" \|\| page === "channels"\) && profile\?\.role === "admin"/);
  assert.match(source, /getTelegramStatus\(accessToken\)/);
  assert.match(source, /page === "company"[\s\S]+<TelegramAccessPanel/);
});
