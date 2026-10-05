import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("content workflow screens keep their dedicated compact layouts", async () => {
  const [contentCss, linkedScripts] = await Promise.all([
    read("components/fullscreen-content.css"),
    read("components/content-linked-scripts.tsx"),
  ]);
  for (const screen of ["screen-scripts", "screen-shorts", "screen-publish", "screen-automation-review"]) {
    assert.match(contentCss, new RegExp(screen));
  }
  assert.match(contentCss, /review-bundles > \.empty-state/);
  assert.match(linkedScripts, /linked-script-body/);
  assert.match(linkedScripts, /linked-script-empty/);
});

test("cardnews preview uses editable copy and enforces saved limits", async () => {
  const templates = await read("components/content-automation-hub.tsx");
  assert.match(templates, /previewTitle/);
  assert.match(templates, /previewBody/);
  assert.match(templates, /draft\.previewTitle\.slice\(0, draft\.titleLimit\)/);
  assert.match(templates, /draft\.previewBody\.slice\(0, draft\.bodyLimit\)/);
  assert.match(templates, /draft\.previewTitle\.length > draft\.titleLimit/);
  assert.match(templates, /draft\.previewBody\.length > draft\.bodyLimit/);
});

test("settings screens use styled status and company layouts without the audit placeholder", async () => {
  const [audit, status, youtube, company, folders, operationsCss] = await Promise.all([
    read("components/audit-workspace.tsx"),
    read("components/system-status-workspace.tsx"),
    read("components/youtube-connection-panel.tsx"),
    read("components/settings-workspaces.tsx"),
    read("components/knowledge-classification-settings.tsx"),
    read("components/fullscreen-operations.css"),
  ]);
  assert.doesNotMatch(audit, /변경 내용을 확인하세요/);
  assert.match(audit, /fullscreen-audit-layout\$\{selected \? " has-detail"/);
  assert.match(status, /system-status-stack/);
  assert.match(youtube, /system-status-channel-card/);
  assert.match(company, /company-settings-stack/);
  assert.match(folders, /knowledge-folder-grid/);
  assert.match(operationsCss, /fullscreen-audit-layout\.has-detail/);
  assert.match(operationsCss, /system-status-details/);
  assert.match(operationsCss, /company-settings-grid/);
});
