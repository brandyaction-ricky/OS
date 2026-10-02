import { findPage } from "@/lib/navigation";
import { KnowledgeWorkspace } from "@/components/knowledge-workspace";

export const metadata = { title: `${findPage("/knowledge").label} | 브랜디 OS` };

export default function KnowledgePage() {
  return <KnowledgeWorkspace />;
}
