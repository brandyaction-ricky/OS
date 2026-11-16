import { imageFileInfo } from "./storage.ts";

export const WAREHOUSE_INDEX_TITLE = "마이인 광고 포맷 창고 — 이미지 광고·영상 레퍼런스";

export interface ReferenceEntry {
  id: string;
  name: string;
  group: string;
  keep: string;
  slots: string;
  source: string;
  thumbnail: string;
  originalImageUrl?: string;
  archivedThumbnail?: string;
  masterRecipe?: string;
  documentId: string;
  version: number;
}
export interface ReferenceCatalog { entries: ReferenceEntry[] }
export type ReferenceSnapshot = Pick<ReferenceEntry, "id" | "documentId" | "version" | "name" | "keep" | "slots">;
export function referenceSnapshot({id, documentId, version, name, keep, slots}: ReferenceEntry): ReferenceSnapshot {
  return {id, documentId, version, name, keep, slots};
}
interface Chapter { id: string; title: string; current_version: number; content_md: string }

const osOrigin = "https://brandyaction-os.vercel.app";
export function warehouseDocumentUrl(id: string) { return `${osOrigin}/knowledge/doc/${encodeURIComponent(id)}`; }
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const links = /\[[^\]\n]*\]\(([^\s)]+)\)/g;

/** The index also links to unrelated video sources after its image chapter list. */
export function warehouseChapterIds(markdown: string): string[] {
  const section = markdown.split(/^##\s+/m).slice(1).find(s => /^이미지 광고 포맷(?:\s|$)/.test(s));
  if (!section) return [];
  const ids = new Set<string>();
  for (const match of section.matchAll(links)) {
    try {
      const url = new URL(match[1], osOrigin);
      if (url.origin !== osOrigin) continue;
      const id = url.pathname === "/knowledge" ? url.searchParams.get("document") : url.pathname.match(/^\/knowledge\/doc\/([^/]+)$/)?.[1];
      if (id && uuid.test(id)) ids.add(id);
    } catch { /* Non-document links in the index are not chapter IDs. */ }
  }
  return [...ids];
}

function httpsLink(markdown: string, image = false) {
  const value = (image ? /!\[[^\]\n]*\]\(([^\s)]+)\)/ : /\[[^\]\n]*\]\(([^\s)]+)\)/).exec(markdown)?.[1];
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function archivedJpeg(section: string) {
  const dataUrl = /^\[보관원본\]:[ \t]+(data:image\/jpeg;base64,[^\s]+)[ \t]*$/m.exec(section)?.[1];
  if (!dataUrl) return;
  const encoded = dataUrl.slice("data:image/jpeg;base64,".length);
  const maxBytes = 128 * 1024;
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return;
  try {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    if (bytes.length <= maxBytes && imageFileInfo(bytes).mime === "image/jpeg") return dataUrl;
  } catch { /* Invalid embedded images fall back to the chapter's HTTPS image. */ }
}

export function referenceCatalogFromDocs(chapters: readonly Chapter[]): ReferenceCatalog {
  const entries: ReferenceEntry[] = [];
  const ids = new Set<string>();
  for (const chapter of chapters) {
    const group = chapter.content_md.match(/^#\s+이미지 광고 포맷\s*·\s*(.+)$/m)?.[1]?.trim();
    if (!group) continue;
    for (const section of chapter.content_md.split(/^##\s+/m).slice(1)) {
      const header = /^([A-Z]+\d{2,})\s*·\s*(.+)/.exec(section);
      if (!header) continue;
      const [, id, name] = header;
      if (ids.has(id)) throw new Error("포맷 창고에서 같은 번호를 두 번 사용했습니다. 해당 항목을 확인해 주세요.");
      ids.add(id);
      const archivedThumbnail = archivedJpeg(section);
      const originalImageUrl = httpsLink(section.match(/^- 제작 원본\s*·.*$/m)?.[0] ?? "");
      const recipeBlock = /^```os-reference-master[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*$/m.exec(section);
      entries.push({
        id, name: name.trim(), group, documentId: chapter.id, version: chapter.current_version,
        keep: section.match(/^- 유지할 연출\s*·\s*(.+)$/m)?.[1]?.trim() ?? "",
        slots: section.match(/^- 교체할 입력\s*·\s*(.+)$/m)?.[1]?.trim() ?? "",
        source: httpsLink(section.match(/^- 원 광고\s*·.*$/m)?.[0] ?? ""),
        thumbnail: httpsLink(section, true),
        ...(originalImageUrl && { originalImageUrl }),
        ...(archivedThumbnail && { archivedThumbnail }),
        ...(recipeBlock && {masterRecipe:recipeBlock[1].trim().slice(0,32*1024+1)}),
      });
    }
  }
  return { entries };
}
