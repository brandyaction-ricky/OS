import { KnowledgeCanonDocument } from "@/components/knowledge/canon";
export const metadata = { title: "정본 | 브랜디 OS" };
export default async function Page({params}:{params:Promise<{id:string}>}){return <KnowledgeCanonDocument id={(await params).id}/>;}
