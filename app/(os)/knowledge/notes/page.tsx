import { KnowledgeNotes } from "@/components/knowledge/notes";
import { KnowledgeReady } from "@/components/knowledge/ui";
export const metadata = { title: "내 노트 | 브랜디 OS" };
export default function NotesPage(){return <KnowledgeReady><KnowledgeNotes/></KnowledgeReady>;}
