import { createHash } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/server";

export const hashShareToken = (token: string) => createHash("sha256").update(token).digest("hex");

// The document behind an external link, or null when the link is unknown, revoked or expired,
// its creator left, or the document went to Trash. Nothing else of the workspace is exposed.
export async function sharedDocument(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const service = createServiceSupabase();
  const { data: link } = await service.from("os_document_share_links").select("document_id,created_by,expires_at,revoked_at")
    .eq("token_hash", hashShareToken(token)).maybeSingle();
  if (!link || link.revoked_at || Date.parse(link.expires_at) <= Date.now()) return null;
  const [{ data: doc }, { data: creator }] = await Promise.all([
    service.from("os_documents").select("title,content_md,status,updated_at").eq("id", link.document_id).maybeSingle(),
    service.from("os_profiles").select("is_active").eq("id", link.created_by).maybeSingle(),
  ]);
  if (!doc || doc.status === "archived" || !creator?.is_active) return null;
  return { title: doc.title as string, content: doc.content_md as string, updatedAt: doc.updated_at as string, expiresAt: link.expires_at as string };
}
