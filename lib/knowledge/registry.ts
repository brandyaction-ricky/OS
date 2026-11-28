/**
 * 업무 표 (대표 2026-11-28): the role table is a Markdown table `| \`role.key\` | \`doc id\` | 담당 범위 | 별칭 |` in §9-2 of the routing document.
 * The canon list reads them to show company canon in three layers and to warn when a role points at a document
 * the team cannot use as canon (a draft, a team document, a review document, or one moved to 자료실).
 */
export const ENTRY_DOCUMENT = "c6b7d39d-43aa-4b09-b58d-6cf8a8dd1563";
export const ROUTING_DOCUMENT = "7745769b-4249-4aef-a354-cbb59846a00a";
/** Where roles are read, first wins per key. The two old registries were merged into the routing document (11-28); they are still read
 *  so the list keeps its roles whichever lands first, the code or the approved merge. */
export const REGISTRY_DOCUMENTS = [ROUTING_DOCUMENT, "c5bc60fb-72bc-4202-90d4-fe21461d2385", "841b6f99-8984-4614-b819-8b67dcb752e3"];
/** Merge role rows read from several documents (in REGISTRY_DOCUMENTS order): the first row for a key wins. */
export function mergeRoles(lists: RegistryRole[][]) {
  const seen = new Set<string>();
  return lists.flat().filter(role => !seen.has(role.key) && Boolean(seen.add(role.key)));
}

export interface RegistryRole { key: string; id: string; scope: string }

export function parseRegistry(markdown: string): RegistryRole[] {
  const rows: RegistryRole[] = [];
  for (const match of markdown.matchAll(/^\|\s*`([a-z0-9][a-z0-9.\-]*)`\s*\|\s*`([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`\s*\|\s*([^|]*)\|/gim)) {
    rows.push({ key: match[1], id: match[2].toLowerCase(), scope: match[3].trim() });
  }
  return rows;
}

/** Plain group names for role key prefixes, in the order the canon list shows them. */
export const ROLE_GROUPS: Array<[string, string[]]> = [
  ["회사", ["brand", "business", "product"]],
  ["마이인", ["myin", "diagnosis"]],
  ["교육·학습", ["education", "learning"]],
  ["콘텐츠 제작", ["content", "youtube", "script", "insights"]],
  ["AI 마케팅 채널", ["aimarketing"]],
  ["AI와 일하기", ["ai"]],
  ["OS 운영", ["os"]],
];
export function roleGroup(key: string) {
  const prefix = key.split(".")[0];
  return ROLE_GROUPS.find(([, prefixes]) => prefixes.includes(prefix))?.[0] ?? "기타";
}

export type RegistryIssueKind = "draft" | "team" | "review" | "reviewed" | "archived" | "library" | "missing";
export const ISSUE_LABELS: Record<RegistryIssueKind, string> = {
  draft: "개인 초안", team: "팀 문서", review: "정본 요청 중", reviewed: "등록 대기", archived: "휴지통", library: "자료실", missing: "찾을 수 없음",
};
/** Why a role's document is not usable company canon, or null when it is. */
export function registryIssue(status: string | undefined, inLibrary: boolean, ownerOnly = false): RegistryIssueKind | null {
  if (!status) return "missing";
  if (status !== "canonical") return (ownerOnly ? "draft" : status) as RegistryIssueKind;
  return inLibrary ? "library" : null;
}
