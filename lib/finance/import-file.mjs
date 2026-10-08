/** Browser parsing: original workbook and unselected columns never leave the browser. */
export const IMPORT_LIMITS = {
  bytes: 5 * 1024 * 1024,
  rows: 5000,
  columns: 100,
  expandedBytes: 25 * 1024 * 1024,
};

export function parseCsv(text) {
  const rows = [],
    row = [];
  let cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else throw new Error("CSV 따옴표 형식이 잘못되었습니다.");
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(cell);
      cell = "";
      if (row.length > IMPORT_LIMITS.columns)
        throw new Error("100열 이하의 파일을 선택하세요.");
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push([...row]);
        row.length = 0;
      }
    } else cell += c;
    if (cell.length > 8192)
      throw new Error("한 칸의 내용은 8,192자 이하여야 합니다.");
    if (rows.length > IMPORT_LIMITS.rows + 1)
      throw new Error("5,000행 이하로 나누어 올려 주세요.");
  }
  if (quoted) throw new Error("CSV의 닫는 따옴표가 없습니다.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return checkTable(rows);
}

function checkTable(rows) {
  if (rows.length < 2)
    throw new Error("제목 행과 거래 내역이 있는 파일을 선택하세요.");
  if (rows.length - 1 > IMPORT_LIMITS.rows)
    throw new Error("5,000행 이하로 나누어 올려 주세요.");
  if (rows.some((row) => row.length > IMPORT_LIMITS.columns))
    throw new Error("100열 이하의 파일을 선택하세요.");
  return {
    headers: rows[0].map((v, i) => String(v).trim() || `열 ${i + 1}`),
    rows: rows.slice(1),
  };
}

// Bound ZIP expansion before handing a workbook to the parser. Reject ZIP64,
// encrypted archives and oversized entries rather than trusting file extension.
export function checkXlsxZip(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (
    let i = view.byteLength - 22;
    i >= Math.max(0, view.byteLength - 65557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("유효한 XLSX 파일이 아닙니다.");
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true),
    total = 0;
  if (!entries || entries > 512)
    throw new Error("워크북이 너무 복잡합니다. CSV로 저장해 주세요.");
  for (let i = 0; i < entries; i++) {
    if (
      at + 46 > end ||
      view.getUint32(at, true) !== 0x02014b50 ||
      view.getUint16(at + 8, true) & 1
    )
      throw new Error("암호화되거나 손상된 XLSX 파일입니다.");
    total += view.getUint32(at + 24, true);
    if (total > IMPORT_LIMITS.expandedBytes)
      throw new Error(
        "압축 해제 크기가 너무 큽니다. CSV로 나누어 저장해 주세요.",
      );
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
}

export async function readImportFile(file) {
  if (file.size > IMPORT_LIMITS.bytes)
    throw new Error("5MB 이하의 파일을 선택하세요.");
  if (/\.csv$/i.test(file.name)) {
    const bytes=await file.arrayBuffer();
    let content;
    try{content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
    catch{content=new TextDecoder("euc-kr",{fatal:true}).decode(bytes);}
    return parseCsv(content);
  }
  if (!/\.xlsx$/i.test(file.name))
    throw new Error(
      ".csv 또는 .xlsx만 지원합니다. .xls는 .xlsx로 다시 저장해 주세요.",
    );
  const buffer = await file.arrayBuffer();
  checkXlsxZip(buffer);
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const sheet = book.worksheets[0];
  if (
    !sheet ||
    sheet.rowCount > IMPORT_LIMITS.rows + 1 ||
    sheet.columnCount > IMPORT_LIMITS.columns
  )
    throw new Error("첫 시트에 5,000행·100열 이하의 내역을 넣어 주세요.");
  const rows = [];
  sheet.eachRow((row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
      else if (
        v &&
        typeof v === "object" &&
        ("formula" in v || "sharedFormula" in v)
      )
        cells.push("#수식불가");
      else cells.push(String(cell.text ?? "").slice(0, 8192));
    });
    rows.push(cells);
  });
  return checkTable(rows);
}

export const IMPORT_FIELDS = {
  cards: [
    ["date", "이용일", true, ["이용일자", "이용일", "거래일", "승인일자"]],
    ["time", "이용 시각", false, ["이용시간", "시각", "거래시간"]],
    ["last", "카드 끝 4자리", true, ["카드번호", "카드", "끝4자리"]],
    ["merchant", "가맹점", true, ["가맹점명", "가맹점", "상호"]],
    ["krw", "원화 금액", true, ["이용금액", "원화금액", "금액", "승인금액"]],
    ["fx", "외화 금액 USD", false, ["해외이용금액", "외화금액", "USD"]],
    ["appr", "승인번호", true, ["승인번호"]],
    ["cancel", "승인 취소", false, ["취소여부", "승인취소", "취소"]],
  ],
  bank: [
    ["date", "거래일", true, ["거래일", "거래일자", "거래일시"]],
    ["time", "거래 시각", false, ["거래시간", "시각"]],
    ["desc", "적요", true, ["적요", "거래내용", "보낸분받는분"]],
    ["in", "입금", false, ["입금", "입금액", "맡기신금액"]],
    ["out", "출금", false, ["출금", "출금액", "찾으신금액"]],
    ["balance", "거래 후 잔액", false, ["잔액", "거래후잔액", "잔액(원)"]],
  ],
};

export function inferMapping(headers, kind) {
  const norm = (v) => v.replace(/[\s()·]/g, "").toLowerCase();
  return Object.fromEntries(
    IMPORT_FIELDS[kind].map(([key, , , aliases]) => [
      key,
      headers.findIndex((h) => aliases.some((a) => norm(h) === norm(a))),
    ]),
  );
}

export function importDate(value) {
  const raw = String(value).trim();
  const match = raw.match(
    /^(\d{4})[-./년\s]?(\d{1,2})[-./월\s]?(\d{1,2})(?:일|\s.*)?$/,
  );
  if (!match) return null;
  const y = Number(match[1]),
    m = Number(match[2]),
    d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 2000 ||
    y > 2099 ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  return date.toISOString().slice(0, 10);
}

const money = (value) => {
  const text = String(value ?? "")
    .trim()
    .replace(/[,\s₩원$]/g, "");
  if (!text) return 0;
  return /^[+-]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
};
export const importKey = (r, kind) =>
  kind === "cards"
    ? [r.last, r.appr, r.date].join("|")
    : [r.acct, r.date, r.time, r.desc, r.in, r.out, r.balance??""].join("|");

export function previewImport(table, mapping, kind, existing, account = "") {
  const needed = IMPORT_FIELDS[kind].filter(([, , required]) => required);
  if (needed.some(([key]) => mapping[key] < 0 || mapping[key] == null))
    throw new Error("필수 열을 모두 연결하세요.");
  if (kind === "bank" && mapping.in < 0 && mapping.out < 0)
    throw new Error("입금 또는 출금 열을 연결하세요.");
  const seen = new Map(existing.map((r) => [importKey(r,kind),r]));
  const valid = [],
    duplicates = [],
    errors = [];
  table.rows.forEach((row, index) => {
    const get = (key) => String(row[mapping[key]] ?? "").trim();
    const date = importDate(get("date"));
    const time = get("time") || "00:00";
    let error = !date
      ? "날짜 형식 확인"
      : !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)
        ? "시간 형식 확인"
        : "";
    const record = { date, time: time.slice(0, 5) };
    if (kind === "cards") {
      Object.assign(record, {
        last: get("last").replace(/\D/g, "").slice(-4),
        merchant: get("merchant"),
        appr: get("appr"),
        krw: money(get("krw")),
        fx: money(get("fx")),
      });
      if (/취소|cancel|^y$/i.test(get("cancel")))
        record.krw = -Math.abs(record.krw);
      if (record.last.length !== 4 || !record.merchant || !record.appr)
        error ||= "카드 끝 4자리·가맹점·승인번호 확인";
      if (
        !Number.isSafeInteger(record.krw) ||
        !record.krw ||
        !Number.isFinite(record.fx) ||
        record.fx < 0
      )
        error ||= "원화 정수·외화 금액 확인";
    } else {
      Object.assign(record, {
        acct: account,
        desc: get("desc"),
        in: money(get("in")),
        out: money(get("out")),
        balance:get("balance")===""?null:money(get("balance")),
      });
      if (!record.desc || !account) error ||= "적요·통장 확인";
      if(record.balance!==null&&!Number.isSafeInteger(record.balance))error ||= "잔액은 원화 정수로 입력";
      if (
        ![record.in, record.out].every(
          (v) => Number.isSafeInteger(v) && v >= 0,
        ) ||
        record.in > 0 === record.out > 0
      )
        error ||= "입금·출금 중 하나에 양수 금액 입력";
    }
    if (row.some((v) => String(v).includes("#수식불가")))
      error ||= "수식은 값으로 붙여 넣어 주세요";
    if (error) {
      errors.push({ line: index + 2, error });
      return;
    }
    const key = importKey(record, kind);
    const prior=seen.get(key);
    if (prior&&(kind!=="cards"||(Math.abs(prior.krw)===Math.abs(record.krw)&&((prior.canceled||prior.krw<0)=== (record.krw<0)||prior.canceled)))) {
      duplicates.push(index + 2);
      return;
    }
    seen.set(key,record);
    const indexOfPrevious=valid.findIndex(r=>importKey(r,kind)===key);
    if(indexOfPrevious>=0)valid[indexOfPrevious]=record;else valid.push(record);
  });
  return { valid, duplicates, errors };
}
