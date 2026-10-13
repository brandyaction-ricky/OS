import { permanentRedirect } from "next/navigation";

// Keep bookmarks usable without retaining a second personal-document workspace.
export default async function NotesRedirect({ searchParams }: {
  searchParams: Promise<{ document?: string; new?: string }>;
}) {
  const query = await searchParams;
  const next = new URLSearchParams();
  if (query.document) next.set("document", query.document);
  else if (query.new === "1") next.set("new", "1");
  permanentRedirect(`/knowledge/vault${next.size ? `?${next}` : ""}`);
}
