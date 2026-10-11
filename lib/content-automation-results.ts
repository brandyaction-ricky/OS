import { z } from "zod";
import { ApiError } from "./http";
import type { AutomationProc } from "./server/content-automation-v07";

export const RESULT_EXAMPLES: Record<AutomationProc,string> = {
  topic:'{"candidates":[{"title":"주제","why":"왜 지금","source":"근거 자료"}]}',
  brief:'{"one":"한 줄 주제","who":"누구에게","msg":"핵심 메시지","src":"근거·자료","warn":"주의"}',
  "card-fill":'{"pages":[{"page":1,"slots":{"칸 이름":"글"}}],"selfCheck":["자가검수 결과"]}',
  "card-caption":'{"caption":"캡션","hashtags":["태그"]}',
  image:'{"request":"이미지 요청서 — 장면·구도·분위기","ratio":"4:5","noText":true}',
  "shorts-cut":'{"cuts":[{"start":"00:03","end":"00:09","text":"자막","note":"화면"}]}',
  "shorts-desc":'{"cover":"커버 문구","title":"제목","description":"설명"}',
  threads:'{"posts":["1번 글","2번 글"]}',
  review:'{"score":0,"checks":[{"key":"항목","ok":true,"note":"근거"}]}',
  reply:'{"replies":[{"commentId":"댓글 번호","text":"답글"}]}',
};
const text=z.string().trim().min(1).max(10_000);
const schemas:Record<AutomationProc,z.ZodTypeAny>={
  topic:z.object({candidates:z.array(z.object({title:text,why:text,source:text})).min(1).max(10)}),
  brief:z.object({one:text,who:text,msg:text,src:text,warn:z.string().max(3000)}),
  "card-fill":z.object({pages:z.array(z.object({page:z.number().int().positive(),slots:z.record(z.string().max(5000))})).min(1),selfCheck:z.array(z.string()).optional()}),
  "card-caption":z.object({caption:text,hashtags:z.array(z.string().max(80)).max(30)}),
  image:z.object({request:text,ratio:z.string().max(20),noText:z.literal(true)}),
  "shorts-cut":z.object({cuts:z.array(z.object({start:text,end:text,text:text,note:z.string().max(3000)})).min(1)}),
  "shorts-desc":z.object({cover:text,title:text,description:text}),
  threads:z.object({posts:z.array(z.string().trim().min(1).max(500)).min(1).max(30)}),
  review:z.object({score:z.number().min(0).max(5),checks:z.array(z.object({key:text,ok:z.boolean(),note:z.string().max(3000)})).min(1)}),
  reply:z.object({replies:z.array(z.object({commentId:text,text:text})).min(1)}),
};
export function parseAutomationResult(proc:AutomationProc,result:unknown) {
  const parsed=schemas[proc].safeParse(result);
  if(!parsed.success)throw new ApiError(422,"JOB_RESULT_INVALID","결과 JSON 형식을 확인해 주세요.",parsed.error.flatten());
  return parsed.data;
}
