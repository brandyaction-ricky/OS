import { KnowledgeDocumentPage } from "@/components/knowledge/editor";
export default async function DocumentPage({params}:{params:Promise<{id:string}>}) {return <KnowledgeDocumentPage id={(await params).id}/>;}
