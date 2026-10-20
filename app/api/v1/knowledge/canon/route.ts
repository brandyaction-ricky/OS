import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { knowledgeAccessContext } from "@/lib/server/knowledge-access";
import { POLICY_FIELDS, readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import type { CanonListDocument, CanonListSnapshot } from "@/lib/knowledge/canon-list";
import type { KnowledgeDocument } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readError() {
  return new ApiError(503, "CANON_READ_FAILED", "정본 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
}

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const service = createServiceSupabase();
    const readDocuments = async () => {
      const rows: KnowledgeDocument[] = [];
      for (let cursor = "00000000-0000-0000-0000-000000000000";;) {
        const result = await user.supabase.from("os_documents")
          .select(`title,folder,review_due_on,current_version,updated_at,${POLICY_FIELDS}`)
          .eq("status", "canonical").gt("id", cursor).order("id").limit(500);
        if (result.error) throw readError();
        const batch = (result.data ?? []) as unknown as KnowledgeDocument[];
        rows.push(...batch);
        if (batch.length < 500) break;
        cursor = batch[batch.length - 1].id;
      }
      // Canonical documents can still be beneath a private parent or tied to a
      // restricted meeting. The same ancestor policy as document detail applies.
      const allowed = await readableKnowledgePages(user, rows);
      return rows.filter(row => allowed.has(row.id));
    };
    const readProposals = async () => {
      const documentIds: string[] = [];
      for (let offset = 0;; offset += 500) {
        const result = await service.from("os_document_proposals").select("id,document_id")
          .eq("status", "open").order("id").range(offset, offset + 499);
        if (result.error) throw readError();
        documentIds.push(...(result.data ?? []).map(row => row.document_id));
        if (!result.data || result.data.length < 500) return documentIds;
      }
    };
    const [documents, proposals, access] = await Promise.all([
      readDocuments(), readProposals(), knowledgeAccessContext(user, []),
    ]);
    const visibleIds = new Set(documents.map(row => row.id));
    const stewardIds = [...new Set(documents.map(row => row.steward_id).filter((id): id is string => Boolean(id)))];
    const people: CanonListSnapshot["people"] = [];
    for (let offset = 0; offset < stewardIds.length; offset += 200) {
      const result = await service.from("os_profiles").select("id,display_name")
        .eq("is_active", true).in("id", stewardIds.slice(offset, offset + 200));
      if (result.error) throw readError();
      people.push(...(result.data ?? []));
    }
    const rows: CanonListDocument[] = documents.map(({ id, title, folder, steward_id, review_due_on, current_version, updated_at }) =>
      ({ id, title, folder, steward_id, review_due_on, current_version, updated_at }));
    return NextResponse.json({ documents: rows, people,
      proposalDocumentIds: [...new Set(proposals.filter(id => visibleIds.has(id)))], actor: access.actor,
    } satisfies CanonListSnapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error instanceof ApiError ? error : readError());
  }
}
