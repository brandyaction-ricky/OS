import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMPANY_FILE_MAX_BYTES, COMPANY_FILE_PATH, COMPANY_FILE_TYPES, companyFileKey, companyFileType, companyFileViewable, subfoldersAt } from "../lib/company-files.ts";

// 서류함 폴더째 올리기 (4954c050): every file in a folder gets a stored type the bucket accepts.
test("folder files map to a bucket type; anything unknown is kept as a plain download", () => {
  assert.deepEqual(companyFileType("협약서.HWP"), { extension: "hwp", mimeType: "application/x-hwp" });
  assert.deepEqual(companyFileType("사업계획.pdf"), { extension: "pdf", mimeType: "application/pdf" });
  for (const name of ["시연.mp4", "README", "index.html", "도면.dwg"]) assert.deepEqual(companyFileType(name), { extension: "bin", mimeType: "application/octet-stream" }, name);
  assert.equal(companyFileViewable("finance/x/2026-10-31/y.pdf"), true);
  assert.equal(companyFileViewable("finance/x/2026-10-31/y.bin"), false);
});

test("stored paths are only the OS's own names", () => {
  const id = "658c5704-ae38-4ddf-a204-9c114c60e55c";
  for (const extension of ["hwp", "bin", "pdf", "xlsx"]) assert.match(`finance/${id}/2026-10-31/${id}.${extension}`, COMPANY_FILE_PATH);
  for (const path of [`finance/${id}/2026-10-31/${id}.html`, `finance/${id}/2026-10-31/../${id}.pdf`, `other/${id}/2026-10-31/${id}.pdf`]) assert.doesNotMatch(path, COMPANY_FILE_PATH);
});

test("the bucket rule and the code list stay the same", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261031120000_company_files_folders.sql", import.meta.url), "utf8");
  const types = new Set([...migration.matchAll(/'([a-z]+\/[^']+)'/g)].map(match => match[1]));
  assert.deepEqual([...types].sort(), [...new Set([...Object.values(COMPANY_FILE_TYPES), "application/octet-stream"])].sort());
  assert.match(migration, new RegExp(`file_size_limit = ${COMPANY_FILE_MAX_BYTES}\\b`));
});

test("a folder shows only its direct sub-folders; a re-chosen folder skips what is already there", () => {
  const paths = ["", "팁스R&D", "팁스R&D/1.협약", "팁스R&D/2.중간보고/증빙", "팁스R&D/2.중간보고", "팁스2/자료"];
  assert.deepEqual(subfoldersAt(paths, "").sort(), ["팁스2", "팁스R&D"].sort());
  assert.deepEqual(subfoldersAt(paths, "팁스R&D"), ["1.협약", "2.중간보고"]);
  assert.deepEqual(subfoldersAt(paths, "팁스R&D/2.중간보고"), ["증빙"]);
  assert.deepEqual(subfoldersAt(paths, "팁스"), [], "a name prefix is not a parent folder");
  const have = new Set([companyFileKey("팁스R&D/1.협약", "협약서.hwp", 2048)]);
  assert.equal(have.has(companyFileKey("팁스R&D/1.협약", "협약서.hwp", 2048)), true);
  assert.equal(have.has(companyFileKey("팁스R&D/1.협약", "협약서.hwp", 4096)), false, "a changed file is uploaded again");
  assert.equal(have.has(companyFileKey("팁스R&D", "협약서.hwp", 2048)), false, "same name elsewhere is its own file");
});
