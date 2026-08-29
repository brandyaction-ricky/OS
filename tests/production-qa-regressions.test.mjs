import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("global shell controls do not present dead actions", async () => {
  const shell = await read("components/app-shell.tsx");
  assert.doesNotMatch(shell, /이 영역에 기능 추가/);
  assert.match(shell, /setNotificationsOpen/);
  assert.match(shell, /새로운 알림이 없습니다/);
});

test("knowledge workspace renders the first page before loading the remainder", async () => {
  const workspace = await read("components/knowledge-workspace.tsx");
  assert.match(workspace, /view=summary&limit=200&offset=0/);
  assert.match(workspace, /setDocuments\(\[\.\.\.all\]\)/);
  assert.match(workspace, /Promise\.all/);
  assert.match(workspace, /문서 불러오는 중/);
  assert.match(workspace, /setSortAscending/);
  assert.match(workspace, /title="문서 정보"/);
});

test("unimplemented knowledge filter and mismatched commerce title are removed", async () => {
  const [search, page] = await Promise.all([
    read("components/knowledge-search.tsx"),
    read("app/(os)/[stage]/[page]/page.tsx"),
  ]);
  assert.doesNotMatch(search, /상세 조건/);
  assert.match(page, /CommerceAdminLinks title="자사몰 어드민"/);
});
