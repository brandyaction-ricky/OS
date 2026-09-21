import { z } from "zod";
export const productionDocumentRoles = { research: "자료·근거", design: "설계표·진행 메모", manuscript: "원고", editing: "편집 지시" } as const;
const version = z.number().int().positive().max(2_147_483_647);
export const productionLinkSchema = z.object({ documentId: z.string().uuid().transform(v => v.toLowerCase()),
  role: z.enum(["research", "design", "manuscript", "editing"]), documentVersion: version, sourceVersion: version }).strict();
export const productionLinksSchema = z.array(productionLinkSchema).max(12).refine(rows => new Set(rows.map(r => r.documentId)).size === rows.length);
export type ProductionDocumentLink = z.infer<typeof productionLinkSchema>;
export const productionDocumentSummarySchema = z.object({ id: z.string().uuid(), title: z.string().min(1).max(300),
  version, status: z.enum(["draft", "team", "review", "reviewed", "canonical"]) }).strict();
export type ProductionDocumentSummary = z.infer<typeof productionDocumentSummarySchema>;
export function productionDocumentId(value: string): string {
  const text = value.trim(); const direct = z.string().uuid().safeParse(text);
  if (direct.success) return direct.data.toLowerCase();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/knowledge" ||
      url.searchParams.getAll("document").length !== 1) throw new Error();
    // Never fetch the pasted URL. Extract only a UUID and resolve it on THIS OS.
    return z.string().uuid().parse(url.searchParams.get("document")).toLowerCase();
  } catch { throw new Error("OS 지식 문서의 링크 또는 문서 ID를 입력해 주세요."); }
}
export function readProductionLinks(value: unknown): ProductionDocumentLink[] | null {
  if (value === undefined) return [];
  const parsed = productionLinksSchema.safeParse(value); return parsed.success ? parsed.data : null;
}
export function addProductionLink(source: { id: string; version: number; metadata: Record<string, unknown> }, document: ProductionDocumentSummary, role: string) {
  const previous = readProductionLinks(source.metadata.productionDocumentLinks);
  if (!previous) throw new Error("기존 문서 연결 형식을 확인할 수 없어 덮어쓰지 않습니다.");
  if (previous.some(row => row.documentId === document.id)) throw new Error("이미 연결한 문서입니다. 새로 연결하지 않고 현재 버전을 다시 확인해 주세요.");
  const link = productionLinkSchema.parse({ documentId: document.id, role, documentVersion: document.version, sourceVersion: source.version + 1 });
  const links = productionLinksSchema.parse([...previous, link]);
  return { id: source.id, expectedVersion: source.version, metadata: { ...source.metadata, productionDocumentLinks: links } };
}
export function removeProductionLink(source: { id: string; version: number; metadata: Record<string, unknown> }, documentId: string) {
  const previous = readProductionLinks(source.metadata.productionDocumentLinks);
  if (!previous || !previous.some(link => link.documentId === documentId)) throw new Error("현재 문서 연결을 확인할 수 없습니다.");
  return { id: source.id, expectedVersion: source.version,
    metadata: { ...source.metadata, productionDocumentLinks: previous.filter(link => link.documentId !== documentId) } };
}
