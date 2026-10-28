// The company 링크 대장 document is rebuilt from os_utm_links each time (the rows are the truth, the document a view).
export const UTM_LEDGER = { source: "utm_ledger", sourceRef: "utm:ledger", title: "링크 대장", folder: "02_Wiki/회사/운영" } as const;

export type UtmLedgerRow = {
  id: string; brand: string; usage: string; created_at: string; creator: string;
  params: Record<string, { code: string; label: string } | null>;
  target: string; location: string; etc: string; utm_url: string; short_url: string | null;
};

const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() || "—";
const day = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export function utmLedgerMarkdown(rows: UtmLedgerRow[]) {
  const param = (row: UtmLedgerRow, kind: string) => row.params[kind] ? `${row.params[kind]!.label} (${row.params[kind]!.code})` : "—";
  const memo = (row: UtmLedgerRow) => [row.target && `대상: ${row.target}`, row.location && `위치: ${row.location}`, row.etc && `기타: ${row.etc}`].filter(Boolean).join(" · ");
  return [
    `# ${UTM_LEDGER.title}`, "",
    "링크관리에서 만든 UTM 링크를 OS가 자동으로 적습니다. 직접 고치지 마세요. 고칠 일이 있으면 링크관리에서 '복제하여 새 링크 만들기'를 쓰세요.", "",
    "| 링크 ID | 만든 날 | 브랜드 | 사용처 | 유입 출처 | 마케팅 방식 | 캠페인명 | 콘텐츠/소재 | 메모 | UTM 링크 | 단축 링크 | 만든 사람 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map(row => `| ${[row.id.slice(0, 8), day(row.created_at), row.brand, row.usage, param(row, "source"), param(row, "medium"), param(row, "campaign"), param(row, "content"), memo(row), row.utm_url, row.short_url ?? "", row.creator].map(cell).join(" | ")} |`),
  ].join("\n");
}
