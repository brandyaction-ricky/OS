import assert from "node:assert/strict";
import test from "node:test";
import { isXlsBinary, readXlsRows } from "../lib/finance/xls-reader.mjs";
import { inferMapping, ledgerTable, previewImport, readImportFile, readImportRows } from "../lib/finance/import-file.mjs";
import * as taxInvoices from "../lib/finance/tax-invoices.ts";

// ---- a tiny .xls writer (Excel 97–2003): only what the reader has to cope with, every value made up ---------------------
const FREE = 0xffffffff, END = 0xfffffffe;
const rec = (id, ...parts) => { const data = Buffer.concat(parts.map(part => Buffer.from(part))); const head = Buffer.alloc(4); head.writeUInt16LE(id, 0); head.writeUInt16LE(data.length, 2); return Buffer.concat([head, data]); };
const u16 = (...values) => { const out = Buffer.alloc(values.length * 2); values.forEach((value, index) => out.writeUInt16LE(value & 0xffff, index * 2)); return out; };
const u32 = (...values) => { const out = Buffer.alloc(values.length * 4); values.forEach((value, index) => out.writeUInt32LE(value >>> 0, index * 4)); return out; };
const f64 = value => { const out = Buffer.alloc(8); out.writeDoubleLE(value); return out; };
const wide = text => /[^\x00-\xff]/.test(text);
const body = (text, asWide) => (asWide ? Buffer.from(text, "utf16le") : Buffer.from(text, "latin1"));
const inline = text => Buffer.concat([u16(text.length), Buffer.from([wide(text) ? 1 : 0]), body(text, wide(text))]);

/** The shared string table, cut into 8,224-byte records; a string cut in the middle restarts with its own width byte. */
function sst(strings, narrowTail = false) {
  const records = [];
  let current = [u32(strings.length, strings.length)], room = 8224 - 8, id = 0x00fc;
  const flush = () => { records.push(rec(id, ...current)); current = []; room = 8224; id = 0x003c; };
  for (const text of strings) {
    const isWide = wide(text) || (narrowTail && text.length > 4000), size = isWide ? 2 : 1;
    if (room < 3 + size) flush();
    current.push(u16(text.length), Buffer.from([isWide ? 1 : 0]));
    room -= 3;
    for (let at = 0, tailWide = isWide; at < text.length; ) {
      if (room < size) { flush(); tailWide = isWide && !(narrowTail && !wide(text)); current.push(Buffer.from([tailWide ? 1 : 0])); room -= 1; }
      const take = Math.min(text.length - at, Math.floor(room / (tailWide ? 2 : 1)));
      current.push(body(text.slice(at, at + take), tailWide));
      room -= take * (tailWide ? 2 : 1);
      at += take;
    }
  }
  records.push(rec(id, ...current));
  return Buffer.concat(records);
}

/** cells: [row, column, value] — string · number · { date } · { rk } · { many: [numbers] } · { formulaText } */
function xls(cells, { narrowTail = false, password = false, hiddenFirst = false } = {}) {
  const strings = [...new Set(cells.map(cell => cell[2]).filter(value => typeof value === "string"))];
  const cellRecords = cells.map(([row, column, value]) => {
    const at = u16(row, column);
    if (typeof value === "string") return rec(0x00fd, at, u16(0), u32(strings.indexOf(value)));
    if (typeof value === "number") return rec(0x0203, at, u16(0), f64(value));
    if ("date" in value) return rec(0x0203, at, u16(1), f64(value.date));
    if ("rk" in value) return rec(0x027e, at, u16(0), u32(Number.isInteger(value.rk) ? (value.rk << 2) | 2 : (Math.round(value.rk * 100) << 2) | 3));
    if ("many" in value) return rec(0x00bd, at, ...value.many.map(n => Buffer.concat([u16(0), u32((n << 2) | 2)])), u16(column + value.many.length - 1));
    return Buffer.concat([rec(0x0006, at, u16(0), Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff]), u16(0), u32(0), u16(0)), rec(0x0207, inline(value.formulaText))]);
  });
  const bof = type => rec(0x0809, u16(0x0600, type, 0, 0), u32(0, 0));
  const sheetStream = Buffer.concat([bof(0x0010), ...cellRecords, rec(0x000a)]);
  const hidden = Buffer.concat([bof(0x0010), rec(0x00fd, u16(0, 0, 0), u32(0)), rec(0x000a)]);
  const globals = offsets => Buffer.concat([
    bof(0x0005), ...(password ? [rec(0x002f, u16(0, 0))] : []),
    rec(0x041e, u16(164), inline("yyyy-mm-dd hh:mm:ss")), rec(0x00e0, u16(0, 0), Buffer.alloc(16)), rec(0x00e0, u16(0, 164), Buffer.alloc(16)),
    ...offsets.map(([offset, state]) => rec(0x0085, u32(offset), Buffer.from([state, 0, 1, 0]), "S")),
    sst(strings.length ? strings : [""], narrowTail), rec(0x000a),
  ]);
  const size = globals(hiddenFirst ? [[0, 1], [0, 0]] : [[0, 0]]).length;
  const stream = hiddenFirst ? Buffer.concat([globals([[size, 1], [size + hidden.length, 0]]), hidden, sheetStream]) : Buffer.concat([globals([[size, 0]]), sheetStream]);

  // Compound file: sector 0 = allocation table, 1 = directory, 2.. = the stream (or the mini stream that holds a small one).
  const pad = (buffer, to) => Buffer.concat([buffer, Buffer.alloc((to - (buffer.length % to)) % to)]);
  const small = stream.length < 4096;
  const data = pad(small ? pad(stream, 64) : stream, 512), sectors = data.length / 512;
  const fat = new Array(128).fill(FREE);
  fat[0] = 0xfffffffd; fat[1] = END;
  for (let index = 0; index < sectors; index++) fat[2 + index] = index === sectors - 1 ? END : 3 + index;
  if (small) fat[2 + sectors] = END;
  const entry = (name, type, child, start, length) => {
    const out = Buffer.alloc(128);
    out.write(name, 0, "utf16le"); out.writeUInt16LE(name.length * 2 + 2, 64); out[66] = type; out[67] = 1;
    out.writeUInt32LE(FREE, 68); out.writeUInt32LE(FREE, 72); out.writeUInt32LE(child, 76); out.writeUInt32LE(start, 116); out.writeUInt32LE(length, 120);
    return out;
  };
  const directory = pad(Buffer.concat([entry("Root Entry", 5, 1, small ? 2 : END, small ? pad(stream, 64).length : 0), entry("Workbook", 2, FREE, small ? 0 : 2, stream.length)]), 512);
  const miniSectors = Math.ceil(stream.length / 64);
  const miniFat = u32(...Array.from({ length: 128 }, (_, index) => (index < miniSectors - 1 ? index + 1 : index === miniSectors - 1 ? END : FREE)));
  const header = Buffer.alloc(512, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  u16(0x003e, 3, 0xfffe, 9, 6).copy(header, 24);
  u32(1, 1, 0, 4096, small ? 2 + sectors : END, small ? 1 : 0, END, 0, 0, ...new Array(108).fill(FREE)).copy(header, 44);
  const file = Buffer.concat([header, u32(...fat), directory, data, ...(small ? [miniFat] : [])]);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.length);
}

const long = (letter, length) => letter.repeat(length);

test(".xls: text, numbers, dates and formula results of the first visible sheet come out as rows of text", () => {
  const rows = readXlsRows(xls([
    [0, 0, "조회기간 : 2026.10.01 ~ 2026.10.31"],
    [2, 0, "거래일시"], [2, 1, "적요"], [2, 2, "금액"], [2, 3, "ASCII only"],
    [3, 0, { date: 46301.604166666664 }], [3, 1, "예시 상점"], [3, 2, 12300], [3, 3, { rk: 12.34 }],
    [4, 0, { date: 46301 }], [4, 1, { formulaText: "수식 글자" }], [4, 2, { many: [1, -2, 300000000] }],
    [5, 0, { rk: -2200000 }], [5, 1, 0.1 + 0.2],
  ]));
  assert.deepEqual(rows, [
    ["조회기간 : 2026.10.01 ~ 2026.10.31", "", "", "", ""],
    ["거래일시", "적요", "금액", "ASCII only", ""],
    ["2026-10-06 14:30:00", "예시 상점", "12300", "12.34", ""],
    ["2026-10-06", "수식 글자", "1", "-2", "300000000"],
    ["-2200000", "0.3", "", "", ""],
  ], "the blank line is dropped, like the .xlsx reader does");
});

test(".xls: a string table that runs over several records is read whole, whichever width its tail is stored in", () => {
  const texts = [long("가", 3000), long("A", 9000), "끝", long("나", 5000), long("B", 4500), "tail"];
  for (const narrowTail of [false, true]) {
    const rows = readXlsRows(xls(texts.map((text, index) => [index, 0, text]), { narrowTail }), { rows: 5000, columns: 100 });
    assert.deepEqual(rows.map(row => row[0].length), [3000, 8192, 1, 5000, 4500, 4], "a cell is capped at 8,192 characters like the other readers");
    assert.equal(rows[3][0], long("나", 5000));
    assert.equal(rows[5][0], "tail");
  }
});

test(".xls: a small file (mini stream) and a large one read the same; a hidden first sheet is skipped", () => {
  const few = [[0, 0, "가"], [0, 1, 1]];
  assert.deepEqual(readXlsRows(xls(few)), [["가", "1"]]);
  const many = Array.from({ length: 400 }, (_, row) => [[row, 0, `거래 ${row}`], [row, 1, row * 1000]]).flat();
  const rows = readXlsRows(xls(many));
  assert.equal(rows.length, 400);
  assert.deepEqual(rows[399], ["거래 399", "399000"]);
  assert.deepEqual(readXlsRows(xls(few, { hiddenFirst: true })), [["가", "1"]]);
});

test(".xls: what cannot be read is refused in words, never half-read", async () => {
  assert.equal(isXlsBinary(new ArrayBuffer(4)), false);
  assert.throws(() => readXlsRows(new TextEncoder().encode("<html><table></table></html>").buffer), /\.xlsx로 저장/);
  assert.throws(() => readXlsRows(xls([[0, 0, "가"]], { password: true })), /암호/);
  assert.throws(() => readXlsRows(xls([[5001, 0, "가"]])), /5,000행/);
  assert.throws(() => readXlsRows(xls([[0, 100, "가"]])), /100열/);
  const broken = new Uint8Array(xls([[0, 0, "가"]]));
  broken.fill(0, 512, 1024); // the allocation table is gone
  assert.throws(() => readXlsRows(broken.buffer), /\.xlsx로 저장/);
  await assert.rejects(() => readImportFile(new File([new Uint8Array(100)], "legacy.xls")), /\.xlsx로 저장/);
  await assert.rejects(() => readImportFile(new File(["a"], "memo.hwp")), /지원/);
});

test("통장 .xls as the bank hands it out: lines above the column names are dropped and the columns connect by themselves", async () => {
  const head = ["No", "거래일시", "보낸분/받는분", "출금액(원)", "입금액(원)", "잔액(원)", "내 통장 표시", "메모", "적요", "처리점", "구분"];
  const file = new File([xls([
    [0, 0, "계좌번호 : 000000-00-000000"], [0, 5, "최초대출일 : "], [1, 0, "총잔액 : 1,087,700"], [4, 0, "출금합계 : 12,300"], [4, 5, "입금합계 : 1,100,000"], [5, 0, "조회기간 : 2026.10.01 ~ 2026.10.31"],
    ...head.map((name, column) => [6, column, name]),
    [7, 0, 1], [7, 1, "2026.10.06 14:30:05"], [7, 2, "예시상사"], [7, 3, 12300], [7, 4, 0], [7, 5, 1087700], [7, 8, "인터넷출금이체"], [7, 9, "예시"],
    [8, 0, 2], [8, 1, "2026.10.05 08:15:40"], [8, 2, "예시결제"], [8, 3, 0], [8, 4, 1100000], [8, 5, 1100000], [8, 8, "전자금융"], [8, 9, "예시"],
  ])], "20261031_0000_000000.xls");
  const raw = await readImportFile(file);
  assert.equal(raw.headers[0], "계좌번호 : 000000-00-000000", "the reader itself keeps the file as it is");
  const table = ledgerTable(raw, "bank");
  assert.deepEqual(table.headers, head);
  const mapping = inferMapping(table.headers, "bank");
  assert.deepEqual(mapping, { date: 1, time: -1, desc: 2, in: 4, out: 3, balance: 5 }, "보낸분/받는분 is the description; 입금액(원) · 출금액(원) connect");
  const preview = previewImport(table, mapping, "bank", [], "a1");
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.valid, [
    { date: "2026-10-06", time: "14:30", acct: "a1", desc: "예시상사", in: 0, out: 12300, balance: 1087700 },
    { date: "2026-10-05", time: "08:15", acct: "a1", desc: "예시결제", in: 1100000, out: 0, balance: 1100000 },
  ], "the time comes from the 거래일시 cell");
  // A file whose first row already is the header stays as it is; so does one this cannot make sense of.
  const plain = { headers: ["거래일", "적요", "입금", "출금"], rows: [["2026-10-06", "예시", "1000", "0"]] };
  assert.equal(ledgerTable(plain, "bank"), plain);
  const odd = { headers: ["메모"], rows: [["가"], ["나"]] };
  assert.equal(ledgerTable(odd, "bank"), odd);
});

test("카드 승인내역: 승인일 · 승인시간 · 상태 connect, a dollar amount is an error, and a cancel line wins in either order", () => {
  const headers = ["승인일", "승인시간", "카드번호", "가맹점명", "승인금액", "승인번호", "상태"];
  const mapping = inferMapping(headers, "cards");
  assert.deepEqual(mapping, { date: 0, time: 1, last: 2, merchant: 3, krw: 4, fx: -1, appr: 5, cancel: 6 });
  const approval = ["2026.10.06", "12:00:01", "0000-00**-****-1234", "예시 상점", "5500", "10000001", "정상"];
  const cancel = ["2026.10.06", "12:05:10", "0000-00**-****-1234", "예시 상점", "-5500", "10000001", "승인취소"];
  const dollars = ["2026.10.07", "03:10:20", "0000-00**-****-1234", "EXAMPLE.COM", "$12.00", "200001", "정상"];
  for (const rows of [[cancel, approval], [approval, cancel]]) {
    const preview = previewImport({ headers, rows: [...rows, dollars] }, mapping, "cards", []);
    assert.deepEqual(preview.valid.map(row => [row.appr, row.krw]), [["10000001", -5500]], "newest-first or oldest-first, the approval ends up canceled");
    assert.equal(preview.errors.length, 1);
    assert.match(preview.errors[0].error, /달러 금액/, "$12.00 is not 12원");
  }
  // Uploading the same file again adds nothing; a later cancel still reaches an approval saved earlier.
  const saved = [{ last: "1234", appr: "10000001", date: "2026-10-06", krw: 5500 }];
  assert.equal(previewImport({ headers, rows: [approval] }, mapping, "cards", saved).valid.length, 0);
  assert.equal(previewImport({ headers, rows: [cancel] }, mapping, "cards", saved).valid.length, 1);
  assert.equal(previewImport({ headers, rows: [approval, cancel] }, mapping, "cards", [{ ...saved[0], canceled: true }]).valid.length, 0);
});

test("홈택스 목록 .xls as downloaded: title lines, then the list — the invoices come out with their totals", async () => {
  const head = ["작성일자", "승인번호", "발급일자", "전송일자", "공급자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소", "공급받는자사업자등록번호", "종사업장번호", "상호", "대표자명", "주소", "합계금액", "공급가액", "세액", "전자세금계산서분류", "전자세금계산서종류", "발급유형", "비고", "영수/청구 구분", "공급자 이메일", "공급받는자 이메일1", "공급받는자 이메일2", "품목일자", "품목명"];
  const line = (row, approval, supplier, name, total, supply, tax, kind) => [["2026-10-06", approval, "2026-10-06", "2026-10-07", supplier, "", name, "홍길동", "예시 주소", "111-22-33333", "", "예시 주식회사", "김예시", "예시 주소", total, supply, tax, kind, "일반", "인터넷발급", "", "영수", "a@example.test", "b@example.test", "", "2026-10-06", "예시 품목"].map((value, column) => [row, column, value])].flat().filter(cell => cell[2] !== "");
  const file = new File([xls([
    [0, 0, "사업자 등록번호"], [0, 1, "111-22-33333"], [0, 2, "상호"], [0, 3, "예시 주식회사"],
    [2, 0, "총 합계금액"], [2, 1, "-1,100,000"], [4, 0, "매입 전자(수정) 세금계산서 목록조회"],
    ...head.map((name, column) => [5, column, name]),
    ...line(6, "20261006-10000000-00000001", "222-33-44444", "예시 상사", 1100000, 1000000, 100000, "세금계산서"),
    ...line(7, "20261006-10000000-00000002", "333-44-55555", "예시 사무소", -2200000, -2000000, -200000, "수정세금계산서"),
  ])], "매입전자세금계산서목록(1~2).xls");
  const parsed = taxInvoices.parseHometaxRows(await readImportRows(file), "purchase");
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.invoices.map(row => [row.approval_no, row.supplier_reg_no, row.supplier_name, row.buyer_reg_no, row.total_amount, row.supply_amount, row.tax_amount, row.is_modified]), [
    ["20261006-10000000-00000001", "2223344444", "예시 상사", "1112233333", 1100000, 1000000, 100000, false],
    ["20261006-10000000-00000002", "3334455555", "예시 사무소", "1112233333", -2200000, -2000000, -200000, true],
  ]);
});
