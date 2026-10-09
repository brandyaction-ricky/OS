import {runKnowledgeMaintenance} from "@/lib/server/knowledge-maintenance";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export function GET(request:Request){return runKnowledgeMaintenance(request,"purge");}
