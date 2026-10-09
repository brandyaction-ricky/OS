import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { fileSchema } from "@/lib/hr/schema";
import { hrRpc, HR_MESSAGES, type HrActor } from "./hr";
const PATH =
  /^(document|leave_proof|credit_evidence|promotion_paper|form)\/(form|[0-9a-f-]{36})\/[0-9a-f-]{36}\.(pdf|jpg|png)$/;
export async function hrUpload(actor: HrActor, input: unknown) {
  const body = fileSchema.parse(input);
  if (body.size > 10485760)
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      "파일은 10MB까지 올릴 수 있습니다.",
    );
  if (!actor.hrAccess) {
    const me = await hrRpc<string | null>(actor, "os_hr_my_employee_id");
    if (body.purpose !== "leave_proof" || !me || body.employee !== me)
      throw new ApiError(
        403,
        "HR_ACCESS_REQUIRED",
        HR_MESSAGES.HR_ACCESS_REQUIRED,
      );
  }
  if (body.purpose !== "form") {
    if (!body.employee)
      throw new ApiError(400, "INVALID_FILE", "파일의 대상을 골라 주세요.");
    const { data, error } = await createServiceSupabase()
      .from("os_hr_employees")
      .select("id")
      .eq("id", body.employee)
      .maybeSingle();
    if (error || !data)
      throw new ApiError(404, "HR_NOT_FOUND", HR_MESSAGES.HR_NOT_FOUND);
  }
  const ext = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
  }[body.mime];
  const path = `${body.purpose}/${body.purpose === "form" ? "form" : body.employee}/${randomUUID()}.${ext}`;
  const { data, error } = await createServiceSupabase()
    .storage.from("hr-documents")
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data)
    throw new ApiError(
      503,
      "HR_STORAGE_NOT_READY",
      "첨부 저장소를 준비하지 못했습니다.",
    );
  return { path, token: data.token, mime: body.mime };
}
export async function hrFileRead(actor: HrActor, path: string) {
  if (!PATH.test(path))
    throw new ApiError(400, "INVALID_FILE", HR_MESSAGES.INVALID_FILE);
  const [kind, target] = path.split("/");
  if (!actor.hrAccess) {
    const me = await hrRpc<string | null>(actor, "os_hr_my_employee_id");
    if (!["leave_proof", "promotion_paper"].includes(kind) || target !== me)
      throw new ApiError(
        403,
        "HR_ACCESS_REQUIRED",
        HR_MESSAGES.HR_ACCESS_REQUIRED,
      );
    const { data, error } = await actor.supabase
      .from(
        kind === "leave_proof"
          ? "os_hr_leave_requests"
          : "os_hr_leave_promotions",
      )
      .select("id")
      .eq("hr_employee_id", me)
      .eq(kind === "leave_proof" ? "proof_path" : "paper_path", path)
      .limit(1);
    if (error || !data?.length)
      throw new ApiError(404, "HR_NOT_FOUND", HR_MESSAGES.HR_NOT_FOUND);
  }
  await hrRpc(actor, "os_hr_file_view", { p_path: path });
  const { data, error } = await createServiceSupabase()
    .storage.from("hr-documents")
    .createSignedUrl(path, 60);
  if (error || !data)
    throw new ApiError(404, "FILE_NOT_FOUND", "파일을 찾지 못했습니다.");
  return { url: data.signedUrl, expiresIn: 60 };
}
