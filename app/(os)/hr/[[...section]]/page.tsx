import { notFound } from "next/navigation";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { HrWorkspace } from "@/components/hr/workspace";
export const dynamic="force-dynamic";
export default async function HrPage({params}:{params:Promise<{section?:string[]}>}){
 if(!hrWorkspaceEnabled())notFound();
 const {section=[]}=await params;
 if(section.length>2||section.length===2&&section[0]!=="employees"||section[0]&&!['employees','leave','leave-ledger','documents','my-leave'].includes(section[0]))notFound();
 return <HrWorkspace/>;
}
