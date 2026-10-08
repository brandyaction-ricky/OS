import { KnowledgeDocumentPage } from "@/components/knowledge/editor";
export const metadata = { title: "문서 | 브랜디 OS" };
export default async function DocumentPage({params}:{params:Promise<{id:string}>}) {return <KnowledgeDocumentPage id={(await params).id}/>;}
