export const COMMENT_KINDS={question:"질문",reaction:"반응",spam:"스팸 의심",sensitive:"민감",unclassified:"미분류"} as const;
export type CommentKind=keyof typeof COMMENT_KINDS;
export function mayHideComment(platform:string,topLevel:boolean){return platform!=="threads"||topLevel;}
export function commentStatusLabel(status:string){return ({unanswered:"미답",replied:"답함",hidden:"숨김"} as Record<string,string>)[status]??"미답";}
export interface CollectedComment { externalId:string; text:string; author:string; topLevel:boolean; createdAt:string }
export function uniqueComments(rows:CollectedComment[]){return [...new Map(rows.filter(row=>row.externalId).map(row=>[row.externalId,row])).values()];}
export function isCommentDraftPatch(current:{metadata:Record<string,unknown>},input:Record<string,unknown>){
  if(Object.keys(input).some(key=>!["id","expectedVersion","metadata"].includes(key)))return false;
  if(!input.metadata||typeof input.metadata!=="object"||Array.isArray(input.metadata))return false;
  const next=input.metadata as Record<string,unknown>,allowed=["replyDraft","draftGenerationId","draftProcedure"];
  if(typeof next.replyDraft!=="string"||Array.from(next.replyDraft).length>500)return false;
  return [...new Set([...Object.keys(current.metadata),...Object.keys(next)])].filter(key=>!allowed.includes(key)).every(key=>JSON.stringify(current.metadata[key])===JSON.stringify(next[key]));
}
