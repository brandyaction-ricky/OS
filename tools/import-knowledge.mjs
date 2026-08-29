#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_OWNER = "wjdgh1346@gmail.com";
const CANONICAL_ROOTS = new Set(["00_Skills", "02_Wiki"]);
const IGNORED = new Set([".git", ".obsidian", "node_modules", ".trash", ".DS_Store"]);

export function parseArgs(args) {
  const result = { root: "", apply: false, ownerEmail: DEFAULT_OWNER };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root") result.root = args[++index] ?? "";
    else if (args[index] === "--apply") result.apply = true;
    else if (args[index] === "--dry-run") result.apply = false;
    else if (args[index] === "--owner-email") result.ownerEmail = args[++index] ?? DEFAULT_OWNER;
    else if (["-h", "--help"].includes(args[index])) result.help = true;
    else throw new Error(`알 수 없는 옵션: ${args[index]}`);
  }
  return result;
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) output.push(absolute);
  }
  return output;
}

function titleOf(fileName, content) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ").trim();
}

export async function scanVault(root) {
  const absoluteRoot = path.resolve(root);
  if (!(await stat(absoluteRoot)).isDirectory()) throw new Error("볼트 경로가 폴더가 아닙니다.");
  const rows = [];
  for (const file of (await walk(absoluteRoot)).sort((a, b) => a.localeCompare(b, "ko"))) {
    const content = await readFile(file, "utf8");
    if (!content.trim()) continue;
    const relative = path.relative(absoluteRoot, file).split(path.sep).join("/").normalize("NFC");
    const [top = ""] = relative.split("/");
    rows.push({
      title: titleOf(relative, content), content, folder: path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative),
      status: CANONICAL_ROOTS.has(top) ? "canonical" : "draft", source: "obsidian_vault", sourceRef: relative,
      contentHash: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content),
    });
  }
  return rows;
}

async function findOwner(supabase, email) {
  const { data, error } = await supabase.from("os_profiles").select("id,email,is_active").eq("email", email).eq("is_active", true).maybeSingle();
  if (error || !data) throw new Error(`활성 구성원 ${email}을 찾지 못했습니다: ${error?.message ?? "없음"}`);
  return data.id;
}

async function applyRows(rows, ownerEmail) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ownerId = await findOwner(supabase, ownerEmail);
  let inserted = 0, updated = 0, unchanged = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const refs = batch.map((row) => row.sourceRef);
    const { data: existing, error: listError } = await supabase.from("os_documents").select("id,source_ref,content_hash,status").eq("source", "obsidian_vault").in("source_ref", refs);
    if (listError) throw new Error(`기존 문서 조회 실패: ${listError.message}`);
    const byRef = new Map((existing ?? []).map((row) => [row.source_ref, row]));
    for (const row of batch) {
      const current = byRef.get(row.sourceRef);
      if (current?.content_hash === row.contentHash) { unchanged += 1; continue; }
      if (current) {
        const { error } = await supabase.from("os_documents").update({ title: row.title, content_md: row.content, folder: row.folder, owner_id: ownerId }).eq("id", current.id);
        if (error) throw new Error(`${row.sourceRef} 수정 실패: ${error.message}`);
        updated += 1;
      } else {
        const { error } = await supabase.from("os_documents").insert({ title: row.title, content_md: row.content, folder: row.folder, status: row.status, source: row.source, source_ref: row.sourceRef, owner_id: ownerId, created_by: ownerId, brand: "", team: "", tags: ["obsidian"] });
        if (error) throw new Error(`${row.sourceRef} 추가 실패: ${error.message}`);
        inserted += 1;
      }
    }
    process.stdout.write(`\r처리 ${Math.min(offset + batch.length, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
  return { inserted, updated, unchanged };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.root) {
    console.log("사용법: npm run import:knowledge -- --root <볼트경로> [--dry-run|--apply] [--owner-email 이메일]");
    process.exit(options.help ? 0 : 1);
  }
  const rows = await scanVault(options.root);
  const summary = { total: rows.length, canonical: rows.filter((row) => row.status === "canonical").length, drafts: rows.filter((row) => row.status === "draft").length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), ownerEmail: options.ownerEmail, mode: options.apply ? "apply" : "dry-run" };
  console.log(JSON.stringify(summary, null, 2));
  if (!options.apply) return;
  console.log(JSON.stringify(await applyRows(rows, options.ownerEmail), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
