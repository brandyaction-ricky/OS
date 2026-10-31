import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { COMPANY_FILE_MAX_BYTES, COMPANY_FILE_PATH, companyFileType } from "@/lib/company-files";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "os-company-files";
const MAX_BYTES = 10_000_000;
const TYPES = new Map([
  ["application/pdf", "pdf"], ["image/jpeg", "jpg"], ["image/png", "png"], ["text/csv", "csv"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
]);

async function requireFinance(request: Request) {
  const actor = await authenticateRequest(request);
  const { data } = await createServiceSupabase().from("os_profiles").select("finance_access,role").eq("id", actor.id).maybeSingle();
  if (!data || (data.role !== "admin" && !data.finance_access)) throw new ApiError(403, "FINANCE_ACCESS_REQUIRED", "경영지원 자료 접근 권한이 필요합니다.");
  return actor;
}

const signedUploadSchema = z.object({ fileName: z.string().trim().min(1).max(255), fileSize: z.number().int().positive().max(COMPANY_FILE_MAX_BYTES) }).strict();

export async function POST(request: Request) {
  try {
    const actor = await requireFinance(request);
    // JSON = a signed upload URL: the browser sends the file straight to the bucket (no 4.5 MB function body limit; folders of large files).
    if (request.headers.get("content-type")?.includes("application/json")) {
      const parsed = signedUploadSchema.safeParse(await parseJson(request, 2_000));
      if (!parsed.success) {
        const tooBig = parsed.error.issues.some(issue => issue.path[0] === "fileSize" && issue.code === "too_big");
        throw new ApiError(tooBig ? 413 : 400, tooBig ? "FILE_TOO_LARGE" : "INVALID_COMPANY_FILE", tooBig ? "파일은 500MB 이하여야 합니다." : "올릴 파일 정보를 확인해 주세요.");
      }
      const { extension, mimeType } = companyFileType(parsed.data.fileName);
      const path = `finance/${actor.id}/${new Date().toISOString().slice(0,10)}/${randomUUID()}.${extension}`;
      const { data, error } = await createServiceSupabase().storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new ApiError(400, "FILE_UPLOAD_FAILED", "파일 올릴 경로를 만들지 못했습니다.", error?.message);
      return NextResponse.json({ path, token: data.token, name: parsed.data.fileName, size: parsed.data.fileSize, type: mimeType }, { status: 201 });
    }
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "업로드할 파일이 필요합니다.");
    const extension = TYPES.get(file.type); if (!extension) throw new ApiError(400, "INVALID_FILE_TYPE", "PDF·JPG·PNG·CSV·XLSX 파일만 올릴 수 있습니다.");
    if (file.size <= 0 || file.size > MAX_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "파일은 10MB 이하여야 합니다.");
    const path = `finance/${actor.id}/${new Date().toISOString().slice(0,10)}/${randomUUID()}.${extension}`;
    const { error } = await createServiceSupabase().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new ApiError(400, "FILE_UPLOAD_FAILED", "파일을 저장하지 못했습니다.", error.message);
    return NextResponse.json({ path, name: file.name, size: file.size }, { status: 201 });
  } catch (error) { return apiErrorResponse(error); }
}

export async function GET(request: Request) {
  try {
    await requireFinance(request); const params = new URL(request.url).searchParams; const path = params.get("path") ?? "";
    if (!COMPANY_FILE_PATH.test(path)) throw new ApiError(400, "INVALID_FILE_PATH", "파일 경로가 올바르지 않습니다.");
    const download = params.get("download")?.trim().slice(0, 240);
    const { data, error } = await createServiceSupabase().storage.from(BUCKET).createSignedUrl(path, 900, download ? { download } : undefined);
    if (error || !data) throw new ApiError(404, "FILE_NOT_FOUND", "파일을 찾지 못했습니다.");
    return NextResponse.json({ url: data.signedUrl });
  } catch (error) { return apiErrorResponse(error); }
}
