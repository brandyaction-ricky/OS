import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEVELOPMENT_ATTACHMENT_MAX_BYTES,
  developmentAttachmentCreateSchema,
  developmentAttachmentPathSchema,
} from "../lib/development-attachments.ts";

const owner = "00000000-0000-4000-8000-000000000001";
const object = "00000000-0000-4000-8000-000000000002";

test("development attachments restrict type, size and private object path", () => {
  const valid = { fileName: "화면.png", fileSize: 2048, mimeType: "image/png" };
  assert.equal(developmentAttachmentCreateSchema.safeParse(valid).success, true);
  assert.equal(developmentAttachmentCreateSchema.safeParse({ ...valid, mimeType: "text/html" }).success, false);
  assert.equal(developmentAttachmentCreateSchema.safeParse({ ...valid, fileSize: DEVELOPMENT_ATTACHMENT_MAX_BYTES + 1 }).success, false);
  assert.equal(developmentAttachmentPathSchema.safeParse("requests/" + owner + "/2026-09-08/" + object + ".png").success, true);
  assert.equal(developmentAttachmentPathSchema.safeParse("../" + object + ".png").success, false);
});

test("attachment API authenticates every operation and never creates public URLs", async () => {
  const route = await readFile(new URL("../app/api/v1/development-attachments/route.ts", import.meta.url), "utf8");
  for (const handler of ["POST", "GET", "DELETE"]) {
    const start = route.indexOf("export async function " + handler);
    const next = route.indexOf("export async function", start + 1);
    const body = route.slice(start, next < 0 ? undefined : next);
    assert.match(body, /authenticateRequest\(request\)/, handler);
  }
  assert.match(route, /createSignedUploadUrl\(path\)/);
  assert.match(route, /createSignedUrl\(path, 900\)/);
  assert.match(route, /assertOwner\(actor, path\)/);
  assert.doesNotMatch(route, /getPublicUrl/);
});

test("attachment migration keeps the bucket private and extends the request guard", async () => {
  const migration = await readFile(new URL("../supabase/migrations/202609080014_development_request_attachments.sql", import.meta.url), "utf8");
  assert.match(migration, /'os-development-attachments'.*false, 26214400/s);
  for (const key of ["attachmentPath", "attachmentName", "attachmentSize", "attachmentType"]) assert.match(migration, new RegExp(key));
  assert.match(migration, /create or replace function public\.os_development_request_guard/);
});
