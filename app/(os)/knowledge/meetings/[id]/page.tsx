import { KnowledgeMeetingPage } from "@/components/knowledge/meetings";
export default async function Page({params}:{params:Promise<{id:string}>}){return <KnowledgeMeetingPage id={(await params).id}/>;}
