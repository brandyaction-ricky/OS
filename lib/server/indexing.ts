import { createHash } from "node:crypto";
import { chunkMarkdown } from "@/lib/chunking";
import { hasServerSupabaseConfig } from "@/lib/config";
import { createServiceSupabase } from "@/lib/supabase/server";
import { createEmbeddings, toPgVector } from "./embeddings";

export async function indexDocument(documentId: string): Promise<"ready" | "queued"> {
  if (!hasServerSupabaseConfig() || !process.env.OPENAI_API_KEY) return "queued";
  const supabase = createServiceSupabase();
  const { data: document, error } = await supabase
    .from("os_documents")
    .select("id,content_md,content_hash,current_version")
    .eq("id", documentId)
    .single();
  if (error || !document) return "queued";

  const chunks = chunkMarkdown(document.content_md);
  if (!chunks.length) return "queued";
  const vectors: number[][] = [];
  for (let offset = 0; offset < chunks.length; offset += 16) {
    vectors.push(...(await createEmbeddings(chunks.slice(offset, offset + 16).map((chunk) => chunk.text), 20_000)));
  }
  const contentHash = document.content_hash || createHash("sha256").update(document.content_md).digest("hex");

  await supabase
    .from("os_embedding_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), error_message: null })
    .eq("document_id", documentId)
    .eq("content_hash", contentHash)
    .eq("status", "pending");

  await supabase.from("os_document_chunks").delete().eq("document_id", documentId);
  const { error: insertError } = await supabase.from("os_document_chunks").insert(
    chunks.map((chunk, index) => ({
      document_id: documentId,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      heading_path: chunk.heading,
      token_count: Math.ceil(chunk.text.length / 3.4),
      embedding: toPgVector(vectors[index]),
      embedding_model: "text-embedding-3-small",
      content_hash: contentHash,
      meta: { version: document.current_version },
    })),
  );
  if (insertError) {
    await supabase
      .from("os_embedding_jobs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: insertError.message })
      .eq("document_id", documentId)
      .eq("content_hash", contentHash);
    throw insertError;
  }
  await supabase
    .from("os_embedding_jobs")
    .update({ status: "done", finished_at: new Date().toISOString(), error_message: null })
    .eq("document_id", documentId)
    .eq("content_hash", contentHash);
  return "ready";
}
