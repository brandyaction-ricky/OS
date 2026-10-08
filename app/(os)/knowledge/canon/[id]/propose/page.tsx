import { KnowledgeProposalPage } from "@/components/knowledge/canon";
export default async function Page({params}:{params:Promise<{id:string}>}){return <KnowledgeProposalPage id={(await params).id}/>;}
