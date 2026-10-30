// A ZIP of already-compressed files (the card PNGs), stored without compressing again. Node's zlib.crc32 (22.2+) is the only helper.
import { crc32 } from "node:zlib";

export function storedZip(files: { name: string; data: Uint8Array }[]) {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8"), crc = crc32(file.data), size = file.data.length;
    // Version 20, flag 0x0800 (UTF-8 names), method 0 (stored), no date.
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(size, 20); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, name, Buffer.from(file.data)); central.push(entry, name);
    offset += 30 + name.length + size;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
