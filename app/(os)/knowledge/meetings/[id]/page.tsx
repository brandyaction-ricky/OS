import { KnowledgeMeetingPage } from "@/components/knowledge/meetings";
export const metadata = { title: "회의 기록 | 브랜디 OS" };
export default async function Page({params}:{params:Promise<{id:string}>}){return <KnowledgeMeetingPage id={(await params).id}/>;}
