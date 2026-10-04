import { findPage } from "@/lib/navigation";
import { KnowledgeWorkspace } from "@/components/knowledge-workspace";
import {KnowledgeTabs} from "@/components/knowledge-tabs";
import {KnowledgeCanonWorkspace} from "@/components/knowledge-canon-workspace";

export const metadata = { title: `${findPage("/knowledge").label} | 브랜디 OS` };

export default async function KnowledgePage({searchParams}:{searchParams:Promise<{tab?:string}>}) {
  const {tab}=await searchParams;
  return <><KnowledgeTabs />{tab==="canon"?<KnowledgeCanonWorkspace />:<KnowledgeWorkspace />}</>;
}
