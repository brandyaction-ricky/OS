import { notFound } from "next/navigation";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { HrWorkspace } from "@/components/hr/workspace";
import type { Metadata } from "next";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{section?:string[]}>}): Promise<Metadata> {
 const {section=[]}=await params;
 const labels:Record<string,string>={employees:"직원 명부",leave:"휴가 관리","leave-ledger":"연차 원장·촉진",documents:"서류·계약","my-leave":"내 휴가"};
 return {title:`${labels[section[0] || "employees"] || "인사 노무 관리"} | 브랜디 OS`};
}
export default async function HrPage({params}:{params:Promise<{section?:string[]}>}){
 if(!hrWorkspaceEnabled())notFound();
 const {section=[]}=await params;
 if(section.length>2||section.length===2&&section[0]!=="employees"||section[0]&&!['employees','leave','leave-ledger','documents','my-leave'].includes(section[0]))notFound();
 return <HrWorkspace/>;
}
