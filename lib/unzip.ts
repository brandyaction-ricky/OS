// 받은 ZIP 넣기 (대표 2026-11-08): ChatGPT hands back every picture of a 웹툰 in one ZIP. The browser opens it itself (its own
// DecompressionStream reads the deflated entries), so no zip library comes in, and only the parts it needs are read off the file.
const PICTURE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** The pictures inside a ZIP, in archive order, each named after its entry without the folder. Text files and macOS `__MACOSX` copies are left out. */
export async function unzipImages(zip: Blob): Promise<File[]> {
  const view = async (from: number, to: number) => new DataView(await zip.slice(from, to).arrayBuffer());
  const u16 = (data: DataView, at: number) => data.getUint16(at, true), u32 = (data: DataView, at: number) => data.getUint32(at, true);
  // The directory's end record sits in the last 22 bytes, or up to 64 KB before them when the ZIP carries a comment.
  const tail = await view(Math.max(0, zip.size - 65_557), zip.size);
  let end = tail.byteLength - 22;
  while (end >= 0 && u32(tail, end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP 파일이 아니에요. ChatGPT가 준 ZIP을 그대로 넣어 주세요.");
  const count = u16(tail, end + 10), dirAt = u32(tail, end + 16);
  // ponytail: no ZIP64 — only archives over 4 GB or 65,535 files need it; a 웹툰 has about 40 pictures.
  if (dirAt === 0xffffffff) throw new Error("ZIP이 너무 커요. 풀어서 그림 파일로 넣어 주세요.");
  const dir = await view(dirAt, dirAt + u32(tail, end + 12));
  const files: File[] = [];
  for (let at = 0, n = 0; n < count && u32(dir, at) === 0x02014b50; n++) {
    const flags = u16(dir, at + 8), method = u16(dir, at + 10), size = u32(dir, at + 20), nameLength = u16(dir, at + 28), local = u32(dir, at + 42);
    const name = new TextDecoder().decode(new Uint8Array(dir.buffer, at + 46, nameLength));
    at += 46 + nameLength + u16(dir, at + 30) + u16(dir, at + 32);
    const base = name.split("/").pop() ?? "", type = PICTURE_TYPES[base.split(".").pop()?.toLowerCase() ?? ""];
    if (!type || base.startsWith(".") || name.startsWith("__MACOSX/") || flags & 1 || (method !== 0 && method !== 8)) continue;
    const head = await view(local, local + 30), from = local + 30 + u16(head, 26) + u16(head, 28);
    const raw = zip.slice(from, from + size);
    const data = method === 0 ? raw : await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    files.push(new File([data], base, { type }));
  }
  return files;
}
