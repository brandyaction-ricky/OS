import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { importContentHash, normalizeImportPath } from "@/lib/knowledge-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ files: z.array(z.object({ id: z.string().min(1).max(100), path: z.string().min(1).max(400), title: z.string().min(1).max(200), hash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(50) });

// Read-only preflight: only documents visible to the importing actor can be
// suggested as update targets. No service-role widening of write permissions.
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = schema.parse(await parseJson(request));
    const paths = input.files.map(file => normalizeImportPath(file.path));
    const fields = "id,title,folder,status,current_version,source_ref,content_md,owner_id";
    const [byPath, byTitle] = await Promise.all([
      actor.supabase.from("os_documents").select(fields).in("source_ref", paths).limit(201),
      actor.supabase.from("os_documents").select(fields).in("title", input.files.map(file => file.title)).limit(201),
    ]);
    if (byPath.error || byTitle.error) throw new ApiError(503, "IMPORT_PREVIEW_FAILED", "기존 문서를 확인하지 못했습니다. 다시 확인해 주세요.");
    if (byPath.data.length > 200 || byTitle.data.length > 200) throw new ApiError(400, "IMPORT_TOO_MANY_MATCHES", "같은 이름의 문서가 많습니다. 가져올 파일 수를 줄여 다시 확인해 주세요.");
    const rows = [...new Map([...byPath.data, ...byTitle.data].map(row => [row.id, row])).values()];
    const hashed = await Promise.all(rows.map(async ({content_md, ...row}) => ({...row, hash: await importContentHash(content_md)})));
    return NextResponse.json({ files: input.files.map(file => ({ id: file.id, candidates: hashed.filter(row => row.source_ref === file.path || row.title === file.title).map(({hash, owner_id, ...row}) => ({...row, sameContent: hash === file.hash, canUpdate: row.status === "draft" && (owner_id === actor.id || actor.role === "admin")})) })) });
  } catch (error) { return apiErrorResponse(error); }
}
