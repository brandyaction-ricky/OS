import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KNOWLEDGE_ATTACHMENT_MAX_BYTES,
  knowledgeAttachmentCreateSchema,
  knowledgeAttachmentDocumentId,
  knowledgeAttachmentMarkdown,
  knowledgeAttachmentPathSchema,
  knowledgeAttachmentTarget,
  parseKnowledgeAttachmentTarget,
} from "../lib/knowledge-attachments.ts";

const documentId = "00000000-0000-4000-8000-000000000001";
const uploaderId = "00000000-0000-4000-8000-000000000002";
const objectId = "00000000-0000-4000-8000-000000000003";
const path = `documents/${documentId}/${uploaderId}/2026-09-29/${objectId}.png`;

test("knowledge attachments validate a private document-scoped object path", () => {
  const valid = { documentId, fileName: "화면.png", fileSize: 2048, mimeType: "image/png" };
  assert.equal(knowledgeAttachmentCreateSchema.safeParse(valid).success, true);
  assert.equal(knowledgeAttachmentCreateSchema.safeParse({ ...valid, mimeType: "text/html" }).success, false);
  assert.equal(knowledgeAttachmentCreateSchema.safeParse({ ...valid, fileSize: KNOWLEDGE_ATTACHMENT_MAX_BYTES + 1 }).success, false);
  assert.equal(knowledgeAttachmentPathSchema.safeParse(path).success, true);
  assert.equal(knowledgeAttachmentPathSchema.safeParse(`documents/${documentId}/../${objectId}.png`).success, false);
  assert.equal(knowledgeAttachmentDocumentId(path), documentId);
});

test("knowledge attachment markdown round-trips safe image, video and file metadata", () => {
  const image = { path, name: "화면 [최종].png", type: "image/png", size: 2048 };
  const target = knowledgeAttachmentTarget(image);
  assert.deepEqual(parseKnowledgeAttachmentTarget(target), image);
  assert.match(knowledgeAttachmentMarkdown(image), /^!\[화면  최종 .png\]\(knowledge-attachment:\?/);
  const video = { ...image, path: path.replace(/\.png$/, ".mp4"), name: "설명.mp4", type: "video/mp4" };
  assert.match(knowledgeAttachmentMarkdown(video), /^\[설명.mp4\]\(knowledge-attachment:\?/);
  assert.equal(parseKnowledgeAttachmentTarget("knowledge-attachment:?path=../secret&type=image%2Fpng&name=x"), null);
});

test("knowledge attachment API checks document access and keeps storage private", async () => {
  const route = await readFile(new URL("../app/api/v1/knowledge-attachments/route.ts", import.meta.url), "utf8");
  for (const handler of ["POST", "GET", "DELETE"]) {
    const start = route.indexOf("export async function " + handler);
    const next = route.indexOf("export async function", start + 1);
    const body = route.slice(start, next < 0 ? undefined : next);
    assert.match(body, /authenticateRequest\(request\)/, handler);
  }
  assert.match(route, /assertEditableDocument\(actor, input\.documentId\)/);
  assert.match(route, /readableDocument\(actor, knowledgeAttachmentDocumentId\(path\)\)/);
  assert.match(route, /createSignedUploadUrl\(path\)/);
  assert.match(route, /registerPendingKnowledgeAttachment\(\{ path, documentId: input\.documentId, uploaderId: actor\.id \}\)/);
  assert.match(route, /createSignedUrl\(path, 900\)/);
  assert.match(route, /forgetKnowledgeAttachment\(path\)/);
  assert.match(route, /claimPendingKnowledgeAttachment\(path\)/);
  assert.doesNotMatch(route, /getPublicUrl/);
});

test("unused uploads are tracked, transactionally referenced and cleaned only through the Storage API", async () => {
  const lifecycleMigration = await readFile(new URL("../supabase/migrations/20260929025147_knowledge_attachment_lifecycle.sql", import.meta.url), "utf8");
  const lifecycle = await readFile(new URL("../lib/server/knowledge-attachment-lifecycle.ts", import.meta.url), "utf8");
  const cron = await readFile(new URL("../app/api/v1/indexing/cron/route.ts", import.meta.url), "utf8");
  const humanDocumentRoute = await readFile(new URL("../app/api/v1/documents/route.ts", import.meta.url), "utf8");
  const documentRoute = await readFile(new URL("../app/api/v1/knowledge-documents/route.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../components/knowledge-workspace.tsx", import.meta.url), "utf8");
  assert.match(lifecycleMigration, /create table if not exists public\.os_knowledge_attachment_uploads/i);
  assert.match(lifecycleMigration, /after insert on public\.os_document_versions/i);
  assert.match(lifecycleMigration, /os_claim_stale_knowledge_attachments/i);
  assert.match(lifecycleMigration, /for update skip locked/i);
  assert.match(lifecycleMigration, /status = 'deleting'/i);
  assert.match(lifecycleMigration, /raise exception 'OS_ATTACHMENT_EXPIRED'/i);
  assert.match(lifecycleMigration, /position\(encoded_path in new\.content_md\) > 0/i);
  assert.match(lifecycleMigration, /revoke all on table public\.os_knowledge_attachment_uploads from public, anon, authenticated/i);
  assert.match(lifecycle, /\.storage\.from\(KNOWLEDGE_ATTACHMENT_BUCKET\)\.remove\(paths\)/);
  assert.match(lifecycle, /\.rpc\("os_claim_stale_knowledge_attachments"/);
  assert.match(humanDocumentRoute, /KNOWLEDGE_ATTACHMENT_EXPIRED/);
  assert.match(documentRoute, /KNOWLEDGE_ATTACHMENT_EXPIRED/);
  assert.doesNotMatch(lifecycle, /from\(["']storage\.objects["']\).*delete/s);
  assert.match(cron, /cleanupPendingKnowledgeAttachments\(\)/);
  assert.match(workspace, /cleanupPendingAttachments\(selected\.id, uploadedPaths\)/);
  assert.match(workspace, /discardAndContinue\(action\)/);
});

test("the knowledge editor previews Markdown live and accepts dragged attachments", async () => {
  const workspace = await readFile(new URL("../components/knowledge-workspace.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(workspace, /onDrop=\{dropAttachments\}/);
  assert.match(workspace, /event\.dataTransfer\.files/);
  assert.match(workspace, /aria-label="실시간 미리보기"/);
  assert.match(workspace, /<MarkdownView content=\{prepareReadingContent\(draft\.content\)\.body\}/);
  assert.match(workspace, /<code>##<\/code> 제목/);
  assert.match(styles, /\.knowledge-live-editor\{[^}]*grid-template-columns:/);
  assert.match(styles, /@media\(max-width:900px\)\{\.knowledge-live-editor\{grid-template-columns:1fr\}/);
});

test("knowledge attachment migration creates a private 100MB bucket", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260929013627_knowledge_document_attachments.sql", import.meta.url), "utf8");
  assert.match(migration, /'os-knowledge-attachments'.*false, 104857600/s);
  assert.doesNotMatch(migration, /public\s*=\s*true/i);
});
