import { KnowledgeBoundary } from "@/components/knowledge/provider";
import "@/components/knowledge/workspace.css";
export default function KnowledgeLayout({ children }: { children: React.ReactNode }) { return <KnowledgeBoundary>{children}</KnowledgeBoundary>; }
