import { findPage } from "@/lib/navigation";
import { KnowledgeReview } from "@/components/knowledge/canon";

export const metadata = { title: `${findPage("/knowledge/review").label} | 브랜디 OS` };

export default function ReviewPage() { return <KnowledgeReview />; }
