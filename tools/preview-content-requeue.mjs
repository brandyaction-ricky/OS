import { readFileSync } from "node:fs";

// Dry run only: accepts an explicitly exported local JSON; never connects to a service.
const path = process.argv[2];
if (!path || process.argv.some(arg => ["--apply", "--write", "--execute"].includes(arg))) {
  console.error("사용법: node tools/preview-content-requeue.mjs <로컬 내보내기.json> (드라이런 전용)");
  process.exitCode = 1;
} else {
  const input = JSON.parse(readFileSync(path, "utf8"));
  const rows = Array.isArray(input) ? input : input.records;
  if (!Array.isArray(rows)) throw new Error("records 배열이 필요합니다.");
  const candidates = rows.filter(row => row.record_type === "ai_job" && row.status === "blocked" && row.stage === "credentials" && !row.archived_at);
  console.log(JSON.stringify({ dryRun: true, candidateCount: candidates.length, changed: 0, next: "원본 콘텐츠 화면에서 새로 요청합니다. 이전 기록은 보존합니다." }));
}
