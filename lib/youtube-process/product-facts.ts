export const FACT_FIELDS = ["상품명", "가격", "무료·유료 범위", "문항 수", "소요 시간", "근거 URL", "확인일"] as const;
export const FACT_TEMPLATE = ["# 상품 사실", "", "각 상품의 실제 운영 값을 한 줄씩 기록해 주세요. 문항 수와 소요 시간이 적용되지 않으면 ‘해당 없음’으로 적습니다.", "", `| ${FACT_FIELDS.join(" | ")} |`, "| --- | --- | --- | --- | --- | --- | --- |", "|  |  |  |  |  |  |  |"].join("\n");

export function productFactRows(md: string) {
  const lines = md.replace(/^`{3,}[\s\S]*?^`{3,}[^\n]*$/gm, "").split(/\r?\n/);
  const cells = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map(v => v.trim());
  const headers = lines.flatMap((line, i) => line.trim().startsWith("|") && cells(line).join("|") === FACT_FIELDS.join("|") ? [i] : []);
  if (headers.length !== 1) return [];
  const start = headers[0];
  if (!cells(lines[start + 1] ?? "").every(v => /^:?-{3,}:?$/.test(v))) return [];
  const rows: Record<string, string>[] = [];
  const names = new Set<string>();
  for (let i = start + 2; lines[i]?.trim().startsWith("|"); i++) {
    const values = cells(lines[i]);
    if (values.length !== FACT_FIELDS.length || values.some(v => !v || v.length > 500) || names.has(values[0])) return [];
    let source: URL;
    try { source = new URL(values[5]); } catch { return []; }
    if (!["https:", "http:"].includes(source.protocol) || !/^\d{4}-\d{2}-\d{2}$/.test(values[6])) return [];
    const date = new Date(values[6]);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== values[6]) return [];
    names.add(values[0]); rows.push(Object.fromEntries(FACT_FIELDS.map((field, j) => [field, values[j]])));
  }
  return rows;
}
