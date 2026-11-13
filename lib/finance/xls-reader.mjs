/**
 * Binary .xls (Excel 97–2003, BIFF8) — what 홈택스, banks and card companies still hand out.
 * Reads the first worksheet's cells as text, in the browser, so a download can be uploaded as it is.
 * No styles, no formulas (only their stored results), no charts.
 */
const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const UNREADABLE = "이 .xls 파일은 읽지 못해요. 엑셀에서 열어 .xlsx로 저장한 뒤 올려 주세요.";
const utf16 = new TextDecoder("utf-16le");

/** True for a real Excel binary; a 홈택스 ".xls" that is an HTML table in disguise is not one. */
export function isXlsBinary(buffer) {
  const head = new Uint8Array(buffer.slice(0, 8));
  return head.length === 8 && MAGIC.every((byte, index) => head[index] === byte);
}

// ---- container (compound file): find the Workbook stream ------------------------------------------------------------
function workbookStream(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at) => view.getUint32(at, true);
  const sectorSize = 1 << view.getUint16(30, true), miniSize = 1 << view.getUint16(32, true);
  if (sectorSize < 512 || sectorSize > 4096 || miniSize > sectorSize) throw new Error(UNREADABLE);
  const sector = (n) => bytes.subarray((n + 1) * sectorSize, (n + 2) * sectorSize);
  const words = (chunk) => {
    const at = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return Array.from({ length: chunk.length >> 2 }, (_, i) => at.getUint32(i * 4, true));
  };
  const join = (parts, size) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return size == null ? out : out.subarray(0, size);
  };
  // Every chain is bounded by the file itself, so a looping or broken table cannot spin.
  const follow = (start, table, pick, size) => {
    const parts = [];
    for (let n = start, guard = 0; n < END && n < table.length; n = table[n]) {
      if (++guard > table.length) throw new Error(UNREADABLE);
      parts.push(pick(n));
    }
    return join(parts, size);
  };
  const difat = Array.from({ length: 109 }, (_, i) => u32(76 + i * 4));
  for (let n = u32(68), guard = 0; n < END && guard++ < 4096; ) {
    const more = words(sector(n));
    n = more.pop();
    difat.push(...more);
  }
  const fat = difat.filter((n) => n < END).flatMap((n) => words(sector(n)));
  const big = (start, size) => follow(start, fat, sector, size);
  const dir = big(u32(48));
  const entries = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const entry = new DataView(dir.buffer, dir.byteOffset + at, 128);
    const nameBytes = Math.max(entry.getUint16(64, true) - 2, 0);
    entries.push({ name: utf16.decode(dir.subarray(at, at + nameBytes)), type: entry.getUint8(66), start: entry.getUint32(116, true), size: entry.getUint32(120, true) });
  }
  const book = entries.find((e) => e.type === 2 && e.name === "Workbook") ?? entries.find((e) => e.type === 2 && e.name === "Book");
  const root = entries.find((e) => e.type === 5);
  if (!book || !root) throw new Error(UNREADABLE);
  if (book.size >= u32(56)) return big(book.start, book.size);
  // Small streams live in the mini stream inside the root entry.
  const mini = big(root.start, root.size);
  const miniFat = words(big(u32(60)));
  return follow(book.start, miniFat, (n) => mini.subarray(n * miniSize, (n + 1) * miniSize), book.size);
}

// ---- records ------------------------------------------------------------------------------------------------------------
function* records(stream, from = 0) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  for (let at = from; at + 4 <= stream.length; ) {
    const id = view.getUint16(at, true), size = view.getUint16(at + 2, true);
    yield { id, data: stream.subarray(at + 4, at + 4 + size) };
    at += 4 + size;
  }
}
const u16 = (data, at) => data[at] | (data[at + 1] << 8);
const u32 = (data, at) => (u16(data, at) | (u16(data, at + 2) << 16)) >>> 0;
const f64 = (data, at) => new DataView(data.buffer, data.byteOffset + at, 8).getFloat64(0, true);
// A narrow string keeps one byte per character (the low byte of its UTF-16 unit).
function chars(data, at, count, wide) {
  if (wide) return utf16.decode(data.subarray(at, at + count * 2));
  let text = "";
  for (let i = at, end = Math.min(at + count, data.length); i < end; i++) text += String.fromCharCode(data[i]);
  return text;
}

/** One string that sits inside a single record: length, flags, text. */
function inlineString(data, at, lengthBytes = 2) {
  const count = lengthBytes === 2 ? u16(data, at) : data[at];
  const flags = data[at + lengthBytes];
  const skip = (flags & 8 ? 2 : 0) + (flags & 4 ? 4 : 0);
  return chars(data, at + lengthBytes + 1 + skip, count, flags & 1);
}

/** The shared string table; a string may run on into the next CONTINUE record, which restarts with its own width flag. */
function sharedStrings(chunks) {
  const out = [];
  const total = u32(chunks[0], 4);
  let chunk = 0, at = 8;
  const skipBytes = (count) => {
    while (count > 0 && chunk < chunks.length) {
      const room = chunks[chunk].length - at;
      if (count <= room) { at += count; return; }
      count -= room; chunk++; at = 0;
    }
  };
  while (out.length < total) {
    while (chunk < chunks.length && at >= chunks[chunk].length) { chunk++; at = 0; }
    if (chunk >= chunks.length) break;
    let data = chunks[chunk];
    let left = u16(data, at);
    const flags = data[at + 2];
    at += 3;
    const runs = flags & 8 ? u16(data, at) : 0;
    if (flags & 8) at += 2;
    const extra = flags & 4 ? u32(data, at) : 0;
    if (flags & 4) at += 4;
    let wide = flags & 1, text = "";
    while (left > 0) {
      if (at >= data.length) {
        if (++chunk >= chunks.length) break;
        data = chunks[chunk];
        wide = data[0] & 1;
        at = 1;
      }
      const take = Math.min(left, Math.floor((data.length - at) / (wide ? 2 : 1)));
      if (take <= 0) { at = data.length; continue; }
      text += chars(data, at, take, wide);
      at += take * (wide ? 2 : 1);
      left -= take;
    }
    skipBytes(runs * 4 + extra);
    out.push(text);
  }
  return out;
}

// ---- cell values --------------------------------------------------------------------------------------------------------
const scratch = new DataView(new ArrayBuffer(8));
function rkNumber(raw) {
  let value;
  if (raw & 2) value = raw >> 2;
  else { scratch.setUint32(0, 0, true); scratch.setUint32(4, (raw & 0xfffffffc) >>> 0, true); value = scratch.getFloat64(0, true); }
  return raw & 1 ? value / 100 : value;
}
const BUILT_IN_DATES = (id) => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
const isDateFormat = (id, custom) => (custom.has(id) ? /[ymdhs]/i.test(custom.get(id).replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) : BUILT_IN_DATES(id));
const two = (n) => String(n).padStart(2, "0");
function numberText(value, asDate, date1904) {
  if (!Number.isFinite(value)) return "";
  if (!asDate) return String(Number(value.toPrecision(15)));
  // A date cell is a day count; the fraction is the time of day.
  const seconds = Math.round(value * 86400);
  const at = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + seconds * 1000);
  const day = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`;
  return value < 1 ? time : seconds % 86400 ? `${day} ${time}` : day;
}

/**
 * Rows of the first worksheet as text, blank rows left out — the same shape the .xlsx reader gives.
 * ponytail: BIFF8 only; older BIFF5 files and password-protected ones are refused with the "save as .xlsx" message.
 */
export function readXlsRows(buffer, limits = { rows: 5000, columns: 100 }) {
  if (!isXlsBinary(buffer)) throw new Error(UNREADABLE);
  let stream;
  try { stream = workbookStream(new Uint8Array(buffer)); } catch { throw new Error(UNREADABLE); }
  const formats = new Map(), cellFormats = [], sheets = [];
  let strings = [], date1904 = false, sst = null, first = true;
  for (const { id, data } of records(stream)) {
    if (sst && id !== 0x003c) { strings = sharedStrings(sst); sst = null; }
    if (first) { first = false; if (id !== 0x0809 || u16(data, 0) !== 0x0600) throw new Error(UNREADABLE); }
    else if (id === 0x002f) throw new Error("암호가 걸린 파일은 읽지 못해요. 암호를 풀어 저장한 뒤 올려 주세요.");
    else if (id === 0x0022) date1904 = u16(data, 0) === 1;
    else if (id === 0x041e) formats.set(u16(data, 0), inlineString(data, 2));
    else if (id === 0x00e0) cellFormats.push(u16(data, 2));
    else if (id === 0x0085) sheets.push({ at: u32(data, 0), hidden: data[4] & 3, type: data[5] });
    else if (id === 0x00fc) sst = [data];
    else if (id === 0x003c && sst) sst.push(data);
    else if (id === 0x000a) break;
  }
  const sheet = sheets.find((s) => s.type === 0 && !s.hidden) ?? sheets.find((s) => s.type === 0);
  if (!sheet) throw new Error(UNREADABLE);
  const asDate = (xf) => xf < cellFormats.length && isDateFormat(cellFormats[xf], formats);
  const rows = [];
  const put = (row, column, text) => {
    if (row > limits.rows) throw new Error("5,000행 이하로 나누어 올려 주세요.");
    if (column >= limits.columns) throw new Error("100열 이하의 파일을 선택하세요.");
    (rows[row] ??= [])[column] = String(text).slice(0, 8192);
  };
  let pending = null, started = false;
  for (const { id, data } of records(stream, sheet.at)) {
    if (id === 0x0809) { if (started) break; started = true; continue; }
    if (id === 0x000a) break;
    if (id === 0x00bd) { // several numbers in one row
      for (let at = 4, column = u16(data, 2); at + 6 <= data.length - 2; at += 6, column++) put(u16(data, 0), column, numberText(rkNumber(u32(data, at + 2)), asDate(u16(data, at)), date1904));
      continue;
    }
    if (id === 0x0207 && pending) { put(pending[0], pending[1], inlineString(data, 0)); pending = null; continue; }
    if (![0x00fd, 0x0204, 0x0203, 0x027e, 0x0006, 0x0205].includes(id)) continue;
    const row = u16(data, 0), column = u16(data, 2), date = asDate(u16(data, 4));
    if (id === 0x00fd) put(row, column, strings[u32(data, 6)] ?? "");
    else if (id === 0x0204) put(row, column, inlineString(data, 6));
    else if (id === 0x0203) put(row, column, numberText(f64(data, 6), date, date1904));
    else if (id === 0x027e) put(row, column, numberText(rkNumber(u32(data, 6)), date, date1904));
    else if (id === 0x0205) put(row, column, data[7] ? "" : data[6] ? "TRUE" : "FALSE");
    else if (u16(data, 12) !== 0xffff) put(row, column, numberText(f64(data, 6), date, date1904)); // a formula's stored number
    else if (data[6] === 0) pending = [row, column]; // a formula's stored text follows in the next record
    else if (data[6] === 1) put(row, column, data[8] ? "TRUE" : "FALSE");
  }
  const width = rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  return Array.from(rows, (row) => Array.from({ length: width }, (_, index) => row?.[index] ?? "")).filter((row) => row.some((cell) => cell.trim()));
}
