import { z } from "zod";
import { ApiError } from "./http";

const memo=z.string().trim().max(5000).default("");
export const shortformBriefSchema=z.object({
  version:z.literal(1),
  mode:z.enum(["reuse","direct"]),
  purpose:z.enum(["organic","ad"]),
  duration:z.union([z.literal(15),z.literal(30),z.literal(60)]),
  product:memo,audience:memo,goal:memo,landingUrl:z.string().trim().max(2000).default(""),
  evidence:memo,assets:memo,appeal:memo,
}).strict();
export type ShortformBrief=z.infer<typeof shortformBriefSchema>;
export const DEFAULT_SHORTFORM_BRIEF:ShortformBrief={
  version:1,mode:"reuse",purpose:"organic",duration:30,
  product:"",audience:"",goal:"",landingUrl:"",evidence:"",assets:"",appeal:"",
};
export function parseShortformBrief(value:unknown):ShortformBrief {
  const parsed=shortformBriefSchema.safeParse(value);
  if(!parsed.success)throw new ApiError(422,"SHORTFORM_BRIEF_INVALID","숏폼 제작 조건을 확인해 주세요.");
  if(parsed.data.landingUrl){
    try{
      const url=new URL(parsed.data.landingUrl);
      if(url.protocol!=="https:"||url.username||url.password)throw new Error();
    }catch{throw new ApiError(422,"SHORTFORM_LANDING_INVALID","연결할 페이지의 HTTPS 주소를 입력해 주세요.");}
  }
  return parsed.data;
}
export function shortformBriefProblem(brief:ShortformBrief,stage:"appeals"|"cuts"|"description"){
  if(!brief.audience)return "누구에게 보여 줄 영상인지 입력해 주세요.";
  if(!brief.goal)return "영상에서 유도할 행동을 입력해 주세요.";
  if(brief.purpose==="ad"&&!brief.product)return "광고할 상품·서비스를 입력해 주세요.";
  if(stage==="cuts"&&brief.purpose==="ad"&&!brief.appeal)return "구매 이유 후보를 검토하고 사용할 이유 하나를 선택해 주세요.";
  if(stage!=="appeals"&&brief.purpose==="ad"&&(!brief.evidence||!brief.landingUrl))
    return "광고 대본에 쓸 실제 근거와 연결할 페이지를 입력해 주세요.";
  return null;
}
const line=z.string().trim().min(1).max(3000);
export const shortformAppealsSchema=z.object({
  appeals:z.array(z.object({
    title:line,reason:line,evidence:z.string().max(5000),basis:z.enum(["evidence","hypothesis"]),
  }).strict()).min(2).max(5),
}).strict();
export const shortformCutsSchema=z.object({
  cuts:z.array(z.object({
    start:line,end:line,text:line,note:z.string().max(3000),
    voice:z.string().max(3000).optional(),
    asset:z.string().max(3000).optional(),
    missingAsset:z.boolean().optional(),
    assetId:z.string().uuid().optional(),
  })).min(1).max(100),
});
export function shortformSeconds(value:string){
  if(!/^\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/.test(value))return NaN;
  const parts=value.split(":").map(Number);
  if(parts.slice(1).some(part=>part>=60))return NaN;
  return parts.reduce((total,part)=>total*60+part,0);
}
export function validateDirectCuts(value:unknown,duration:number){
  const result=shortformCutsSchema.safeParse(value);
  if(!result.success)throw new ApiError(422,"SHORTFORM_CUTS_INVALID","장면별 시간·자막·화면 구성을 확인해 주세요.");
  let end=0;
  for(const cut of result.data.cuts){
    const from=shortformSeconds(cut.start),to=shortformSeconds(cut.end);
    if(!Number.isFinite(from)||!Number.isFinite(to)||Math.abs(from-end)>0.001||to<=from||to>duration
      ||cut.voice===undefined||cut.asset===undefined||cut.missingAsset===undefined)
      throw new ApiError(422,"SHORTFORM_TIMELINE_INVALID","직접 제작은 00:00부터 빈틈 없이 시간·내레이션·소재·미확보 여부를 적어 주세요.");
    end=to;
  }
  if(Math.abs(end-duration)>0.001)
    throw new ApiError(422,"SHORTFORM_DURATION_INVALID","장면의 총 길이를 선택한 영상 길이에 맞춰 주세요.");
  return result.data;
}

export const SHORTFORM_APPEAL_EXAMPLE=JSON.stringify({appeals:[
  {title:"구매 이유 후보",reason:"이 고객에게 필요한 이유",evidence:"입력된 근거 또는 확인할 자료",basis:"hypothesis"},
  {title:"다른 구매 이유",reason:"다른 고객 상황",evidence:"입력된 근거 또는 확인할 자료",basis:"hypothesis"},
]});
export const shortformDirectExample=(duration=30)=>JSON.stringify({cuts:[
  {start:"00:00",end:"00:03",text:"첫 화면 자막",note:"실제 상품 화면",voice:"내레이션",asset:"입력된 소재 이름",missingAsset:false},
  {start:"00:03",end:duration===60?"01:00":`00:${duration}`,text:"본문과 행동 유도",note:"장면별로 나누어 작성",voice:"근거에 맞춘 내레이션",asset:"추가 촬영할 화면",missingAsset:true},
]});
