import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { financeError } from "@/lib/server/finance";
import { readToss } from "@/lib/server/finance-toss";

export const dynamic="force-dynamic";
export const maxDuration=120;

export async function GET(request:Request,context:{params:Promise<{action:string}>}){
  try{
    return NextResponse.json(await readToss(request,(await context.params).action),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    const response=apiErrorResponse(financeError(error));
    response.headers.set("Cache-Control","private, no-store");
    return response;
  }
}
