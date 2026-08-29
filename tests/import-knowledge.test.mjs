import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs, scanVault } from "../tools/import-knowledge.mjs";

test("vault paths are normalized and canonical roots are mapped", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brandy-vault-"));
  await mkdir(path.join(root, "02_Wiki")); await mkdir(path.join(root, "01_Raw"));
  await writeFile(path.join(root, "02_Wiki", "정본.md"), "# 회사 정본\n내용");
  await writeFile(path.join(root, "01_Raw", "초안.md"), "개인 초안");
  await writeFile(path.join(root, "empty.md"), "");
  const rows = await scanVault(root);
  assert.equal(rows.length, 2); assert.equal(rows.find((row) => row.status === "canonical")?.title, "회사 정본"); assert.equal(rows.find((row) => row.status === "draft")?.sourceRef, "01_Raw/초안.md");
});

test("import is dry-run unless apply is explicit", () => {
  assert.equal(parseArgs(["--root", "/vault"]).apply, false);
  assert.equal(parseArgs(["--root", "/vault", "--apply"]).apply, true);
});
