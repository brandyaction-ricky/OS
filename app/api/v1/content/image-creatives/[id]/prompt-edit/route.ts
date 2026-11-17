import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { imageError } from "@/lib/server/image-creatives";
import { imagePromptEditRequest, proposeImagePromptEdit } from "@/lib/server/image-prompt-edit";
import { IMAGE_FILE_MAX } from "@/lib/image-creative/storage";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;

async function multipartInput(request:Request) {
  const limit=IMAGE_FILE_MAX+64_000;
  if (Number(request.headers.get("content-length") ?? 0)>limit || !request.body)
    throw new ApiError(413,"IMAGE_PROMPT_SOURCE_SIZE","현재 시안 PNG는 5MB 이하로 보내 주세요.");
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let size=0;
  try {
    for (;;) {
      const item=await reader.read();if(item.done)break;
      size+=item.value.byteLength;
      if(size>limit){await reader.cancel();throw new ApiError(413,"IMAGE_PROMPT_SOURCE_SIZE","현재 시안 PNG는 5MB 이하로 보내 주세요.");}
      chunks.push(item.value);
    }
  } finally {reader.releaseLock();}
  try {
    const form=await new Response(new Uint8Array(Buffer.concat(chunks)),{headers:{"content-type":request.headers.get("content-type") ?? ""}}).formData();
    const metadata=form.get("metadata"),sourcePng=form.get("sourcePng");
    if(typeof metadata!=="string" || new TextEncoder().encode(metadata).byteLength>8192 || !sourcePng || typeof sourcePng==="string" ||
      form.getAll("metadata").length!==1 || form.getAll("sourcePng").length!==1 || [...form.keys()].some(key=>!["metadata","sourcePng"].includes(key)))
      throw new ApiError(422,"IMAGE_PROMPT_INPUT_INVALID","수정 요청과 현재 PNG 한 장을 함께 보내 주세요.");
    return {input:imagePromptEditRequest.parse(JSON.parse(metadata)),sourcePng};
  } catch(error) {
    if(error instanceof ApiError || error instanceof ZodError)throw error;
    throw new ApiError(422,"IMAGE_PROMPT_INPUT_INVALID","수정 요청과 현재 PNG를 읽지 못했어요.");
  }
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor=await authenticateRequest(request,{allowAgent:false});
    const id=z.string().uuid().parse((await params).id);
    const parsed=request.headers.get("content-type")?.startsWith("multipart/form-data") ? await multipartInput(request) :
      {input:imagePromptEditRequest.parse(await parseJson(request,8192)),sourcePng:undefined};
    return Response.json(await proposeImagePromptEdit(actor,id,parsed.input,parsed.sourcePng),{headers:{"cache-control":"private, no-store"}});
  } catch (error) {
    return apiErrorResponse(error instanceof ZodError ? new ApiError(422,"IMAGE_PROMPT_INPUT_INVALID","수정할 소재와 2,000자 이내의 요청을 확인해 주세요.") : imageError(error));
  }
}
