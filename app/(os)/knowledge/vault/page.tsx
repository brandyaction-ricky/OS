import { KnowledgeWorkspace } from "@/components/knowledge-workspace";
import "@/components/knowledge-vault.css";

export const metadata = { title: "문서 보관함 | 브랜디 OS" };

export default function DocumentVaultPage() {
  return <KnowledgeWorkspace vault />;
}
