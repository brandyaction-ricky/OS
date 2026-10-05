import { validWorkDate } from "./task-management.ts";
import type { OsRecord } from "./record-types";
import type { MeetingTerm } from "./meeting-term-settings";
export type MeetingReviewKind = "decision" | "task" | "pending" | "excluded";
export interface MeetingReviewItem { id: string; kind: MeetingReviewKind; title: string; assigneeId: string; assigneeHint: string; dueDate: string; doneCriteria: string }
export interface ReviewMember { id: string; display_name: string; email: string; is_active: boolean }
export interface ExtractedMeeting { decisions: string[]; pending: string[]; todos: Array<{title:string;assignee:string;dueDate:string;dueLabel:string}> }
export const MEETING_TERMS = [{from:"마인",to:"마이인"},{from:"자산몰",to:"자사몰"}];
export function normalizeMeetingTerms(value: string, customTerms: MeetingTerm[] = []) {
  let normalized = value.replace(/(?<![가-힣])마인(?=$|[\s·,.:!?/]|으로|에서|을|이|의|은)/g,"마이인").replace(/(?<![가-힣])자산몰(?=$|[\s·,.:!?/]|으로|에서|을|이|의|은)/g,"자사몰");
  for (const term of customTerms) {
    if (!term.from || !term.to || term.from === term.to) continue;
    const source = term.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(new RegExp(`(?<![가-힣a-zA-Z0-9])${source}(?=$|[\\s·,.:!?/]|으로|에서|을|이|의|은)`, "g"), () => term.to);
  }
  return normalized;
}
export function matchMeetingAssignee(name: string, members: ReviewMember[]) {
  const normalized=name.trim().toLocaleLowerCase();if(!normalized)return "";
  const matches=members.filter(member=>member.is_active && [member.display_name,member.email,member.email.split("@")[0]].some(value=>value?.trim().toLocaleLowerCase()===normalized));
  return matches.length===1?matches[0].id:"";
}
export function makeMeetingReview(extracted: ExtractedMeeting, members: ReviewMember[], id=()=>crypto.randomUUID(), terms: MeetingTerm[] = []): MeetingReviewItem[] {
  const base=(title:string,kind:MeetingReviewKind):MeetingReviewItem=>({id:id(),kind,title:normalizeMeetingTerms(title, terms),assigneeId:"",assigneeHint:"",dueDate:"",doneCriteria:""});
  return [...extracted.decisions.map(title=>base(title,"decision")),...extracted.pending.map(title=>base(title,"pending")),...extracted.todos.filter(todo=>todo && typeof todo.title==="string").map(todo=>({...base(todo.title,"task"),assigneeId:matchMeetingAssignee(typeof todo.assignee==="string"?todo.assignee:"",members),assigneeHint:typeof todo.assignee==="string"?todo.assignee:"",dueDate:typeof todo.dueDate==="string"?todo.dueDate:"",doneCriteria:""}))];
}
export function meetingReviewErrors(items: MeetingReviewItem[], members: ReviewMember[]) {
  if(items.length>100)return ["한 번에 100개까지 검수할 수 있습니다. 항목을 나누어 주세요."];
  const seen = new Set<string>();
  const active=new Set(members.filter(member=>member.is_active).map(member=>member.id));
  return items.flatMap((item,index)=>{
    if(item.kind==="excluded")return [];
    const key=`${item.kind}:${item.title.trim()}`;
    if(seen.has(key))return [`${index+1}번 항목이 중복됩니다. 내용을 구분하거나 제외해 주세요.`];
    seen.add(key);
    if(!item.title.trim())return [`${index+1}번 항목의 내용을 입력해 주세요.`];
    if(item.title.trim().length>240)return [`${index+1}번 항목은 240자 이하로 입력해 주세요.`];
    if(item.kind!=="task")return [];
    const date=validWorkDate(item.dueDate);
    return [...(!active.has(item.assigneeId)?[`${index+1}번 업무 담당자를 선택해 주세요.`]:[]),...(!date?[`${index+1}번 업무 기한을 지정해 주세요.`]:[])];
  });
}
export function similarMeetings(records: OsRecord[], title: string, brand: string, localDate: string, excluding="", terms: MeetingTerm[] = []) {
  if(!localDate)return [];
  const words=(text:string)=>new Set(normalizeMeetingTerms(text, terms).toLowerCase().replace(/회의|\d+/g," ").split(/[^가-힣a-z]+/).filter(Boolean));
  const wanted=words(title);
  return records.filter(record=>{
    if(record.id===excluding || record.archived_at || !record.starts_at)return false;
    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(record.starts_at));
    if(day!==localDate)return false;
    const tokens=words(record.title), common=[...tokens].filter(token=>wanted.has(token)).length;
    return (brand.trim() && normalizeMeetingTerms(record.brand, terms)===normalizeMeetingTerms(brand, terms)) || common/Math.max(1,new Set([...tokens,...wanted]).size)>=0.4;
  });
}
export function decisionSource(record: Pick<OsRecord,"metadata"|"source_url">) {
  const source=String(record.metadata.source ?? "");
  if(source==="meeting" || record.metadata.meetingId)return "meeting";
  if(source.includes("telegram") || record.metadata.telegramMessageId || record.source_url?.includes("t.me/"))return "telegram";
  if(source==="planning" || source==="content" || record.metadata.kind==="content_hypothesis" || record.metadata.contentId || record.metadata.sourceId)return "planning";
  return "direct";
}

export function readMeetingReview(value: unknown): MeetingReviewItem[] | null {
 if(!Array.isArray(value))return null;
 const fields=["id","title","assigneeId","assigneeHint","dueDate","doneCriteria"] as const;
 if(value.some(item=>!item||typeof item!=="object"||!["decision","task","pending","excluded"].includes(item.kind)||fields.some(key=>typeof item[key]!=="string")))return null;
 return value.slice(0,100);
}
