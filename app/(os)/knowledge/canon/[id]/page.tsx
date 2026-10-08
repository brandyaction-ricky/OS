import { KnowledgeCanonDocument } from "@/components/knowledge/canon";
export default async function Page({params}:{params:Promise<{id:string}>}){return <KnowledgeCanonDocument id={(await params).id}/>;}
