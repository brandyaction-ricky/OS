import { ApiError } from "@/lib/http";
import { myinCleanScript } from "@/lib/myin-script";
import { checkScriptBody } from "@/lib/youtube-script-check";
import type { RequestActor } from "./auth";

export const SCRIPT_CANON = ["원고 공정 정본", "원고 구조 정본", "원고 말투 정본", "원고 검수 정본"];
export const canonIds = () => (process.env.YOUTUBE_SCRIPT_CANON_IDS ?? "").split(",").map((value) => value.trim()).filter((id) => /^[0-9a-f-]{36}$/i.test(id));

/** The four 원고 정본 (현재기준 is not one of them) by title. */
export async function scriptCanonDocs(supabase: RequestActor["supabase"]) {
  const ids = canonIds();
  const query = supabase.from("os_documents").select("title,content_md");
  const { data, error } = await (ids.length ? query.in("id", ids) : query.in("title", SCRIPT_CANON).eq("status", "canonical"));
  const docs = (data ?? []).filter((doc) => SCRIPT_CANON.includes(doc.title as string));
  if (error || new Set(docs.map((doc) => doc.title)).size < SCRIPT_CANON.length)
    throw new ApiError(409, "SCRIPT_CANON_UNAVAILABLE", "원고 정본 네 편을 열지 못해 관문 1(정본 겹침)을 셀 수 없습니다. 잠시 뒤 다시 해 주세요.");
  return Object.fromEntries(docs.map((doc) => [String(doc.title), String(doc.content_md ?? "")]));
}
/** The four 원고 정본 that the 관문 1 정본 겹침 count compares a script against. */
export const scriptCanonText = async (supabase: RequestActor["supabase"]) => Object.values(await scriptCanonDocs(supabase)).join("\n");

/**
 * 관문 1 body rules on the 원고 as it will be spoken, whoever wrote it last (원고 검수 정본 §7: a paragraph a person edited
 * runs 관문 1 again). The AI's own submission is counted in full when it arrives; this covers the 구성안 editor.
 */
export async function assertSpokenScript(supabase: RequestActor["supabase"], markdown: string, targetMinutes: number | null) {
  const { issues } = checkScriptBody(myinCleanScript(markdown).spoken, targetMinutes, null, await scriptCanonText(supabase));
  if (issues.length) throw new ApiError(422, "SCRIPT_FORMAT_INVALID", `원고 형식 검사(관문 1)에서 걸린 곳 ${issues.length}건: ${issues.join(" / ")}`);
}
