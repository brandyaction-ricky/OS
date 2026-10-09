import { permanentRedirect } from "next/navigation";
import { KnowledgeHome } from "@/components/knowledge/home";
export const metadata = { title: "문서 홈 | 브랜디 OS" };
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ tab?: string; document?: string; new?: string }> }) {
  const query = await searchParams;
  if (query.document) permanentRedirect(`/knowledge/doc/${encodeURIComponent(query.document)}`);
  if (query.tab === "canon") permanentRedirect("/knowledge/canon");
  if (query.new === "1") permanentRedirect("/knowledge/notes?new=1&tab=all");
  return <KnowledgeHome/>;
}
