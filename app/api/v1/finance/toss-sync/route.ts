import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { financeError } from "@/lib/server/finance";
import { readTossSync,writeTossSync } from "@/lib/server/finance-toss-sync";

export const dynamic="force-dynamic";
export const maxDuration=120;
async function handle(request:Request,write:boolean){
  try{return NextResponse.json(await (write?writeTossSync(request):readTossSync(request)),{headers:{"Cache-Control":"private, no-store"}});}
  catch(error){const response=apiErrorResponse(financeError(error));response.headers.set("Cache-Control","private, no-store");return response;}
}
export async function GET(request:Request){return handle(request,false);}
export async function POST(request:Request){return handle(request,true);}
