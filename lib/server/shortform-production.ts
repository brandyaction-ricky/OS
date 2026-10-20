import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { parseShortformBrief,shortformBriefProblem,shortformAppealsSchema,validateDirectCuts } from "@/lib/shortform-production";

export function shortformJobInput(target:OsRecord,proc:string,sub:string){
  if(!["shorts-cut","shorts-desc"].includes(proc))return null;
  if(target.record_type!=="content_publish"||target.metadata.channel!=="shorts"
    ||!["draft","blocked"].includes(target.status))
    throw new ApiError(409,"SHORTFORM_TARGET_INVALID","제작 중인 내 숏폼 카드에서 실행해 주세요.");
  const brief=target.metadata.shortformBrief===undefined?null:parseShortformBrief(target.metadata.shortformBrief);
  const stage=proc==="shorts-desc"?"description":sub==="appeals"?"appeals":"cuts";
  if(stage==="appeals"&&(!brief||brief.purpose!=="ad"))
    throw new ApiError(422,"SHORTFORM_AD_REQUIRED","광고 용도를 선택한 뒤 구매 이유 후보를 요청해 주세요.");
  if(brief){
    const problem=shortformBriefProblem(brief,stage);
    if(problem)throw new ApiError(422,"SHORTFORM_INPUT_REQUIRED",problem);
  }
  return {id:target.id,title:target.title,brand:target.brand,channel:"shorts",
    description:target.description??"",brief:target.metadata.brief??null,
    shortformBrief:brief,stage,
    cuts:proc==="shorts-desc"?target.metadata.cuts??[]:[],
  };
}
export function shortformInputKey(input:ReturnType<typeof shortformJobInput>){
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export function assertShortformJobCurrent(target:OsRecord,job:OsRecord){
  if(!job.metadata.shortformInputKey){
    if(target.metadata.shortformBrief&&["shorts-cut","shorts-desc"].includes(String(job.metadata.proc)))
      throw new ApiError(409,"SHORTFORM_INPUT_CHANGED","현재 제작 조건으로 AI 작업을 다시 요청해 주세요.");
    return;
  }
  const input=shortformJobInput(target,String(job.metadata.proc),String(job.metadata.sub??""));
  if(shortformInputKey(input)!==job.metadata.shortformInputKey)
    throw new ApiError(409,"SHORTFORM_INPUT_CHANGED","제작 조건이 바뀌었습니다. 이전 AI 작업을 닫고 현재 내용으로 다시 요청해 주세요.");
}
export function validateShortformJobResult(job:OsRecord,result:unknown){
  const input=job.metadata.shortformInput as ReturnType<typeof shortformJobInput>|undefined;
  if(!input)return result;
  if(input.stage==="appeals"){
    const parsed=shortformAppealsSchema.safeParse(result);
    if(!parsed.success)throw new ApiError(422,"SHORTFORM_APPEALS_INVALID","구매 이유 후보·근거·가설 여부를 확인해 주세요.");
    return parsed.data;
  }
  if(input.stage==="cuts"&&input.shortformBrief?.mode==="direct")
    return validateDirectCuts(result,input.shortformBrief.duration);
  if(input.stage==="cuts"&&(!result||typeof result!=="object"||!("cuts" in result)))
    throw new ApiError(422,"SHORTFORM_CUTS_REQUIRED","이 작업에는 컷 구성 결과가 필요합니다.");
  return result;
}
export function validateShortformReview(metadata:Record<string,unknown>){
  if(metadata.channel!=="shorts"||!metadata.shortformBrief)return;
  const brief=parseShortformBrief(metadata.shortformBrief);
  const problem=shortformBriefProblem(brief,"cuts");
  if(problem)throw new ApiError(422,"SHORTFORM_INPUT_REQUIRED",problem);
  if(brief.mode==="direct"){
    const plan=validateDirectCuts({cuts:metadata.cuts},brief.duration);
    if(plan.cuts.some(cut=>cut.missingAsset))
      throw new ApiError(422,"SHORTFORM_ASSETS_MISSING","장면별 미확보 소재를 준비한 뒤 최종 확인으로 보내 주세요.");
  }
}

export function invalidateShortformVideo(current:OsRecord,metadata:Record<string,unknown>,description?:string){
  if(metadata.channel!=="shorts"||!metadata.shortformBrief)return metadata;
  const changed=JSON.stringify(current.metadata.shortformBrief)!==JSON.stringify(metadata.shortformBrief)
    ||JSON.stringify(current.metadata.cuts)!==JSON.stringify(metadata.cuts)
    ||description!==undefined&&description!==current.description;
  // A replacement upload can be submitted with the edited plan. Never delete files.
  if(changed&&metadata.mp4Path&&metadata.mp4Path===current.metadata.mp4Path)
    return {...metadata,mp4Path:"",mp4Source:"",needsRecheck:true};
  return metadata;
}
