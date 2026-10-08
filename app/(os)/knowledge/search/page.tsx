import { findPage } from "@/lib/navigation";
import { KnowledgeSearchPage } from "@/components/knowledge/search";

export const metadata = { title: `${findPage("/knowledge/search").label} | 브랜디 OS` };

export default function SearchPage() { return <KnowledgeSearchPage />; }
