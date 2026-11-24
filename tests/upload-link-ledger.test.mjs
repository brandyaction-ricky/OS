import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("업로드 링크 → 링크 대장: one row per video, as the link really is, written after the upload and by a button", async () => {
  const { campaignFor, UTM_OPTIONS } = await import("../lib/youtube-process/stages.ts");
  assert.deepEqual(UTM_OPTIONS.camp.map(([code]) => code), ["sales", "leed", "core", "free"], "the ledger's campaign codes");
  assert.equal(campaignFor("https://www.myinlab.co.kr/services/n6", "leed"), "sales");
  assert.equal(campaignFor("https://www.myinlab.co.kr/services/free", "sales"), "leed");
  assert.equal(campaignFor("https://example.com/x", "core"), "core");
  const ledger = read("lib/server/utm-links.ts");
  assert.match(ledger, /export async function ledgerUploadLink/);
  assert.match(ledger, /insert\(\{ kind, label: label\.slice\(0, 80\), code, active: false/, "missing values are added turned off");
  assert.match(ledger, /await syncUtmLedger\(input\.by\);/);
  assert.ok(ledger.includes("/^https:\\/\\/(?:www\\.)?myinlab\\.co\\.kr\\/r\\/([A-Za-z0-9_-]+)$/"), "the upload screen saves short links without www");
  const upload = read("lib/server/youtube-process-upload.ts");
  assert.match(upload, /if \(!short\) await ledgerYoutubeUpload\(actor, project\.id\)\.catch\(/, "a failed ledger write never fails the upload");
  assert.match(upload, /requestId: ypUuid\(`yp-ledger:\$\{project\.id\}:\$\{videoId\}`\)/, "once per video");
  assert.match(upload, /content: utmCode\(project\.id\), utmUrl: utmUrl\(upload\.utm, utmCode\(project\.id\)\)/, "the OS code, as in the real link (대표 11-24)");
  assert.match(read("app/api/v1/content/youtube/projects/[id]/upload/route.ts"), /action === "ledger" \? await ledgerYoutubeUpload\(actor, id\)/);
});

test("영상별 구매 · 기여 매출 come from the 매출 tab's numbers by video id", () => {
  const page = read("components/content-performance-dashboard.tsx");
  assert.match(page, /useVideoSales\(from, tab === "summary" \|\| tab === "videos" \? to : ""\)/);
  assert.match(page, /\{ \.\.\.group, purchases: salesByVideo\.get\(group\.key\)\?\.orders \?\? 0, revenue: salesByVideo\.get\(group\.key\)\?\.net \?\? 0 \}/);
});
