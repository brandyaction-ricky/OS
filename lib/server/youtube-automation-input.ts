import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { selectedPackaging } from "@/lib/content-selected-packaging";
import { buildYoutubeAutomationPlan, type YoutubeAutomationPlan } from "@/lib/youtube-automation-plan";
import { APPROVED_SCRIPT_STATUSES, narrationFromMarkdown } from "@/lib/youtube-narration-document";
import type { RequestActor } from "./auth";
import { readPipeline } from "./content-pipeline";

type Supabase = Pick<RequestActor, "supabase">["supabase"];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The approved script document at its current version, with only the spoken text. */
export async function readApprovedScriptDocument(supabase: Supabase, documentId: string) {
  const { data: doc } = await supabase.from("os_documents").select("id,title,status,current_version").eq("id", documentId).maybeSingle();
  if (!doc || !(APPROVED_SCRIPT_STATUSES as readonly string[]).includes(doc.status))
    throw new ApiError(409, "SCRIPT_DOCUMENT_NOT_APPROVED", "원고 문서를 '검토완료' 또는 '정본' 상태로 승인한 뒤 시작해 주세요.");
  const { data: version } = await supabase.from("os_document_versions").select("content_md")
    .eq("document_id", documentId).eq("version_no", doc.current_version).maybeSingle();
  const text = narrationFromMarkdown(String(version?.content_md ?? ""));
  if (!version || !text) throw new ApiError(409, "SCRIPT_DOCUMENT_EMPTY", "승인된 원고 문서에서 낭독할 본문을 찾지 못했습니다.");
  return { id: doc.id as string, title: doc.title as string, version: doc.current_version as number,
    contentSha256: sha256(String(version.content_md)), text };
}

/**
 * One place every automation step reads its input: either the content pipeline's
 * approved script (gates 1 and 2) or an approved script document bound to a
 * document-backed source. Swap this function when the content-flow contract lands.
 */
export async function readYoutubeAutomationInput(supabase: Supabase, sourceId: string) {
  const state = await readPipeline({ supabase }, sourceId);
  const ref = state.source.metadata.scriptDocument as { id?: unknown; version?: unknown; contentSha256?: unknown } | undefined;
  if (ref) {
    const doc = typeof ref.id === "string" ? await readApprovedScriptDocument(supabase, ref.id).catch(() => null) : null;
    const ready = Boolean(doc && doc.version === ref.version && doc.contentSha256 === ref.contentSha256);
    const plan: YoutubeAutomationPlan = {
      format: "narrated_visual", privacyStatus: "private", judgmentMode: "advisory_only", sourceId,
      inputKey: ready && doc ? sha256(JSON.stringify(["narrated-document-v1", sourceId, doc.id, doc.version, doc.contentSha256])) : null,
      currentStage: ready ? "ready_for_voice" : "needs_input",
      missing: ready ? [] : ["승인된 원고 문서의 연결 당시 버전 (문서가 수정됐거나 승인 상태가 아니면 새로 연결)"],
      script: ready && doc ? { id: doc.id, version: doc.version } : null, packaging: null, kit: null,
    };
    return { state, plan, scriptText: ready && doc ? doc.text : null, title: state.source.title, thumbnailCopy: "" };
  }
  const plan = buildYoutubeAutomationPlan(state);
  const script = state.records.find((record) => record.id === plan.script?.id && record.version === plan.script.version);
  const packaging = selectedPackaging(state.records, sourceId);
  return { state, plan, scriptText: script?.description ?? null, title: packaging?.title ?? state.source.title,
    thumbnailCopy: packaging?.thumbnailCopies.join(" / ") ?? "" };
}
