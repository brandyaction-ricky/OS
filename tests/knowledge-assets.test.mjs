import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  knowledgeAssetFileName,
  knowledgeAssetReferences,
  knowledgeAssetRecoveryCandidates,
  normalizeKnowledgeAssetReference,
} from "../lib/knowledge-assets.ts";

test("Obsidian and Markdown local image references normalize without rewriting document content", () => {
  const content = [
    "![[이미지/표지.PNG|640]]",
    "![설명](../assets/표지%202.png)",
    "![원격](https://example.com/a.png)",
    "![첨부](knowledge-attachment:?path=documents%2Fx)",
    "![[이미지\\표지.PNG]]",
  ].join("\n");
  assert.deepEqual(knowledgeAssetReferences(content), [
    { reference: "이미지/표지.PNG", referenceKey: "이미지/표지.png", fileName: "표지.PNG" },
    { reference: "../assets/표지%202.png", referenceKey: "../assets/표지 2.png", fileName: "표지%202.png" },
  ]);
  assert.equal(normalizeKnowledgeAssetReference("./A\\B%20C.PNG"), "a/b c.png");
  assert.equal(knowledgeAssetFileName("folder/photo.png|300"), "photo.png");
});

test("duplicate image names stay ambiguous until a folder path or a person selects the right file", () => {
  const reference = { reference: "캡처.png", referenceKey: "캡처.png", fileName: "캡처.png" };
  const files = [
    { id: "one", name: "캡처.png", path: "브랜드/캡처.png" },
    { id: "two", name: "캡처.png", path: "강의/캡처.png" },
  ];
  assert.deepEqual(knowledgeAssetRecoveryCandidates(reference, files).map(({ id }) => id), ["one", "two"]);
  assert.deepEqual(knowledgeAssetRecoveryCandidates({ ...reference, reference: "브랜드/캡처.png", referenceKey: "브랜드/캡처.png" }, files).map(({ id }) => id), ["one"]);
});

test("knowledge asset migration is additive, indexed, RLS protected and reuses attachment lifecycle", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261001060319_knowledge_asset_links.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.os_knowledge_assets/i);
  assert.match(migration, /references public\.os_documents\(id\) on delete cascade/i);
  assert.match(migration, /unique \(document_id, reference_key\)/i);
  assert.match(migration, /split_part\(storage_path, '\/', 2\) = document_id::text/i);
  assert.match(migration, /os_knowledge_assets_document_id_idx/i);
  assert.match(migration, /os_knowledge_assets_document_sha256_idx/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /using \(\(select public\.os_can_read_document\(document_id\)\)\)/i);
  assert.match(migration, /revoke all on table public\.os_knowledge_assets from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.os_knowledge_assets to authenticated/i);
  assert.match(migration, /status = 'referenced'/i);
  assert.match(migration, /raise exception 'OS_ATTACHMENT_EXPIRED'/i);
  assert.doesNotMatch(migration, /create table.*storage\.objects/is);
});

test("knowledge asset API authenticates reads and writes, validates document scope and keeps storage private", async () => {
  const route = await readFile(new URL("../app/api/v1/knowledge-assets/route.ts", import.meta.url), "utf8");
  for (const handler of ["GET", "POST", "PATCH"]) {
    const start = route.indexOf(`export async function ${handler}`);
    const next = route.indexOf("export async function", start + 1);
    assert.match(route.slice(start, next < 0 ? undefined : next), /authenticateRequest\(request\)/, handler);
  }
  assert.match(route, /assertEditableDocument\(actor, input\.documentId\)/);
  assert.match(route, /knowledgeAttachmentDocumentId\(input\.path\) !== input\.documentId/);
  assert.match(route, /createSignedUploadUrl\(path\)/);
  assert.match(route, /createSignedUrl\(path, 900\)/);
  assert.match(route, /registerPendingKnowledgeAttachment/);
  assert.match(route, /url: await signedUrl\(String\(row\.storage_path\)\)/);
  assert.match(route, /filter\(\(asset\) => asset\.url\)/);
  assert.match(route, /status !== "pending"/);
  assert.doesNotMatch(route, /getPublicUrl/);
});

test("knowledge workspace exposes relinking, bulk restore and configurable table/gallery views", async () => {
  const workspace = await readFile(new URL("../components/knowledge-workspace.tsx", import.meta.url), "utf8");
  const inline = await readFile(new URL("../components/knowledge-inline.tsx", import.meta.url), "utf8");
  const gallery = await readFile(new URL("../components/knowledge-gallery.tsx", import.meta.url), "utf8");
  const recovery = await readFile(new URL("../components/knowledge-image-recovery.tsx", import.meta.url), "utf8");
  assert.match(workspace, /갤러리 보기/);
  assert.match(workspace, /KnowledgeImageRecovery/);
  assert.match(inline, /다시 연결/);
  assert.match(inline, /크게 보기/);
  assert.match(inline, /내려받기/);
  assert.match(gallery, /모든 태그/);
  assert.match(gallery, /모든 소유자/);
  assert.match(gallery, /카드 속성/);
  assert.match(gallery, /보기 저장/);
  assert.match(recovery, /본문은 수정하지 않고/);
  assert.match(recovery, /webkitdirectory/);
  assert.match(recovery, /올바른 파일 선택/);
  assert.match(recovery, /선택한 파일에서 찾지 못한 이미지/);
});
