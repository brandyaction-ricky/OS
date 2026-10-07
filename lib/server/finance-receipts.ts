import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '@/lib/http';
import type { RequestActor } from './auth';
import { financeDbError } from './finance';
const allowed=['image/png','image/jpeg','image/gif','image/webp','application/pdf'];
export async function receiptUpload(actor:RequestActor,input:unknown){
  const body=z.object({transactionId:z.string().uuid(),fileSize:z.number().int().min(1).max(10485760),mimeType:z.string().refine(x=>allowed.includes(x))}).strict().parse(input);
  const {data,error}=await actor.supabase.from('os_fin_card_transactions').select('id').eq('id',body.transactionId).is('archived_at',null).single();
  if(error||!data)throw new ApiError(404,'FINANCE_NOT_FOUND','카드 거래를 찾지 못했습니다.');
  const suffix=({ 'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','application/pdf':'pdf' } as Record<string,string>)[body.mimeType];
  // Do not put original filenames (which may contain PII) in object URLs.
  const path=`cards/${body.transactionId}/${randomUUID()}.${suffix}`;
  const {data:upload,error:uploadError}=await actor.supabase.storage.from('finance-receipts').createSignedUploadUrl(path,{upsert:false});
  if(uploadError||!upload)throw new ApiError(503,'FINANCE_STORAGE_UNAVAILABLE','영수증 저장소를 준비하지 못했습니다.');
  return {path,token:upload.token,mimeType:body.mimeType};
}
export async function receiptAttach(actor:RequestActor,id:string,input:unknown){
  const body=z.object({version:z.number().int().positive(),path:z.string().max(300).nullable()}).strict().parse(input);
  z.string().uuid().parse(id);
  if(body.path){
    if(!new RegExp(`^cards/${id}/[0-9a-f-]{36}\\.(png|jpg|gif|webp|pdf)$`).test(body.path))throw new ApiError(400,'FINANCE_RECEIPT_PATH','이 거래의 영수증 파일만 연결할 수 있습니다.');
    const {data,error}=await actor.supabase.storage.from('finance-receipts').info(body.path);
    if(error||!data)throw new ApiError(400,'FINANCE_UPLOAD_INCOMPLETE','파일 업로드가 끝난 뒤 다시 저장해 주세요.');
    const meta=data.metadata as {size?:number;mimetype?:string};
    if(!meta?.size||meta.size>10485760||!allowed.includes(meta.mimetype||''))throw new ApiError(400,'FINANCE_RECEIPT_INVALID','영수증 파일 크기·형식을 확인해 주세요.');
  }
  const {data,error}=await actor.supabase.from('os_fin_card_transactions').update({receipt_path:body.path,updated_by:actor.id}).eq('id',id).eq('version',body.version).is('archived_at',null).select('*').maybeSingle();
  if(error)financeDbError(error);if(!data)throw new ApiError(409,'FINANCE_VERSION_CONFLICT','다른 사람이 먼저 고쳤습니다. 새로 불러와 주세요.');
  // Unlink only: old object remains private/recoverable. No irreversible delete here.
  return {row:data};
}
export async function receiptRead(actor:RequestActor,id:string){
  z.string().uuid().parse(id);
  const {data,error}=await actor.supabase.from('os_fin_card_transactions').select('receipt_path').eq('id',id).is('archived_at',null).single();
  if(error||!data?.receipt_path)throw new ApiError(404,'FINANCE_RECEIPT_MISSING','첨부된 영수증이 없습니다.');
  const {data:url,error:signError}=await actor.supabase.storage.from('finance-receipts').createSignedUrl(data.receipt_path,60);
  if(signError||!url)throw new ApiError(503,'FINANCE_STORAGE_UNAVAILABLE','파일을 열 수 없습니다.');
  return {url:url.signedUrl,expiresIn:60};
}
