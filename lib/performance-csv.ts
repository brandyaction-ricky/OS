export interface RevenueCsvRow {
  date: string;
  brand: "마이인" | "브랜디액션 에듀";
  gross: number;
  cancel: number;
  refund: number;
  orders: number;
  buyers: number;
  source: string;
}

export interface AdCsvRow {
  provider: "meta" | "google";
  brand: "myin" | "brandyedu";
  date: string;
  spend: number;
  attributedRevenue: number;
  conversions: number;
  impressions: number;
  clicks: number;
}

function parseLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if ((character === "," || character === "\t") && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function rows(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV에 헤더와 데이터 행이 필요합니다.");
  if (lines.length > 2_001) throw new Error("한 번에 최대 2,000행까지 가져올 수 있습니다.");
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/[\s_-]/g, ""));
  return lines.slice(1).map((line, rowIndex) => {
    const values = parseLine(line);
    const item = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return { item, rowNumber: rowIndex + 2 };
  });
}

function value(item: Record<string, string>, ...aliases: string[]) {
  for (const alias of aliases) {
    const found = item[alias.toLowerCase().replace(/[\s_-]/g, "")];
    if (found !== undefined) return found;
  }
  return "";
}

function numeric(raw: string, rowNumber: number, field: string) {
  const normalized = raw.replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized || 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${rowNumber}행 ${field} 값을 확인해 주세요.`);
  return parsed;
}

function dateValue(raw: string, rowNumber: number) {
  const normalized = raw.replace(/[./]/g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${rowNumber}행 기준일은 YYYY-MM-DD 형식이어야 합니다.`);
  return normalized;
}

function revenueBrand(raw: string, rowNumber: number): RevenueCsvRow["brand"] {
  const normalized = raw.trim().toLowerCase();
  if (["마이인", "myin"].includes(normalized)) return "마이인";
  if (["브랜디액션 에듀", "브랜디액션에듀", "brandyedu", "brandyactionedu"].includes(normalized)) return "브랜디액션 에듀";
  throw new Error(`${rowNumber}행 브랜드는 마이인 또는 브랜디액션 에듀여야 합니다.`);
}

export function parseRevenueCsv(text: string): RevenueCsvRow[] {
  return rows(text).map(({ item, rowNumber }) => ({
    date: dateValue(value(item, "date", "기준일", "일자"), rowNumber),
    brand: revenueBrand(value(item, "brand", "브랜드"), rowNumber),
    gross: numeric(value(item, "gross", "총매출"), rowNumber, "총매출"),
    cancel: numeric(value(item, "cancel", "취소"), rowNumber, "취소"),
    refund: numeric(value(item, "refund", "환불"), rowNumber, "환불"),
    orders: numeric(value(item, "orders", "주문수", "주문"), rowNumber, "주문 수"),
    buyers: numeric(value(item, "buyers", "구매자수", "구매자"), rowNumber, "구매자 수"),
    source: value(item, "source", "출처") || "CSV 업로드",
  }));
}

export function parseAdCsv(text: string): AdCsvRow[] {
  return rows(text).map(({ item, rowNumber }) => {
    const providerRaw = value(item, "provider", "채널", "플랫폼").trim().toLowerCase();
    if (!(["meta", "google"] as string[]).includes(providerRaw)) throw new Error(`${rowNumber}행 채널은 meta 또는 google이어야 합니다.`);
    const brand = revenueBrand(value(item, "brand", "브랜드"), rowNumber) === "마이인" ? "myin" : "brandyedu";
    return {
      provider: providerRaw as AdCsvRow["provider"],
      brand,
      date: dateValue(value(item, "date", "기준일", "일자"), rowNumber),
      spend: numeric(value(item, "spend", "광고비"), rowNumber, "광고비"),
      attributedRevenue: numeric(value(item, "attributedrevenue", "전환매출", "귀속매출"), rowNumber, "전환 매출"),
      conversions: numeric(value(item, "conversions", "전환수", "전환"), rowNumber, "전환 수"),
      impressions: numeric(value(item, "impressions", "노출수", "노출"), rowNumber, "노출 수"),
      clicks: numeric(value(item, "clicks", "클릭수", "클릭"), rowNumber, "클릭 수"),
    };
  });
}
