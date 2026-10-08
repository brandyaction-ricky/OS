import { KnowledgeProposalPage } from "@/components/knowledge/canon";
export const metadata = { title: "정본 변경 제안 | 브랜디 OS" };
export default async function Page({params}:{params:Promise<{id:string}>}){return <KnowledgeProposalPage id={(await params).id}/>;}
