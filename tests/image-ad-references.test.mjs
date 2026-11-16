import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { warehouseChapterIds, referenceCatalogFromDocs, referenceSnapshot } from "../lib/image-creative/reference-canon.ts";
import { approveImageFormat, emptyImageCreative, formatApprovalKey, imageCreativePrompt } from "../lib/image-creative/model.ts";
import { selectedReferencePlan } from "../lib/image-creative/direction.ts";

const docId = "00000000-0000-4000-8000-000000001234";
const other = "00000000-0000-4000-8000-000000001235";
const chapter = {id:docId, title:"견본", current_version:4, content_md:`# 이미지 광고 포맷 · 시험 분류
## M01 · 달라진 이름
![원 광고](https://example.org/preview.webp)
- 유지할 연출 · 위쪽에 주인공 한 명
- 교체할 입력 · 행동 한 문장
- 원 광고 · [광고 출처](https://example.org/original)
## A22 · 서재
- 원 광고 · [잘못된 링크](javascript:alert)
`};

test("창고 목차에서 이미지 장만 순서대로 읽고 현재 이름·연출·출처·버전을 추출한다", () => {
  const md = `# 포맷 창고
## 이미지 광고 포맷 73종
- [A](/knowledge?document=${docId})
- [B](/knowledge/doc/${other})
- [중복](/knowledge/doc/${docId})
- [다른 사이트](https://example.org/knowledge/doc/${docId})
## 영상 레퍼런스
- [영상](/knowledge/doc/00000000-0000-4000-8000-000000001236)
`;
  assert.deepEqual(warehouseChapterIds(md), [docId, other]);
  const data = referenceCatalogFromDocs([chapter]).entries;
  assert.deepEqual(data[0], {id:"M01", name:"달라진 이름", group:"시험 분류", documentId:docId, version:4,
    keep:"위쪽에 주인공 한 명", slots:"행동 한 문장", thumbnail:"https://example.org/preview.webp", source:"https://example.org/original"});
  assert.equal(data[1].source, "");
  assert.throws(()=>referenceCatalogFromDocs([chapter,chapter]), /같은 번호/);
  const updated = referenceCatalogFromDocs([{...chapter, current_version:5, content_md:chapter.content_md.replace("M01", "M14")}]);
  assert.deepEqual(updated.entries.map(row => [row.id, row.version]), [["M14", 5], ["A22", 5]]);
});

test("승인한 창고 원문 버전을 카피에 사용하고 기존 승인과 렌더러 버전을 보존한다", () => {
  const state = emptyImageCreative();
  state.brief = {brand:"공방", product:"컵", offer:"컵 한 개", audience:"처음 오는 분", objective:"예약", funnel:"예약"};
  const req = {mode:"standalone", count:1, formatIds:["M01"], size:"portrait"};
  state.formatRecommendation = selectedReferencePlan(state.brief, "standalone", "portrait", [{id:"angle",meaning:"직접 만든 잔"}]);
  const stamp = {by:"tester",at:"2026-11-12T01:00:00Z"};
  const legacy = approveImageFormat(state, req, stamp);
  const entry = referenceSnapshot(referenceCatalogFromDocs([chapter]).entries[0]);
  const approved = approveImageFormat(state, req, stamp, entry);
  assert.notEqual(approved.formatApproval.key, legacy.formatApproval.key);
  assert.equal(legacy.formatApproval.key, formatApprovalKey(legacy, req));
  assert.equal(approved.formatApproval.key, formatApprovalKey(approved, req));
  const prompt = imageCreativePrompt(approved, req);
  for (const value of [entry.name, entry.keep, entry.slots]) assert.ok(prompt.includes(value));
  const revised = approveImageFormat(approved, req, stamp, {...entry,version:5,keep:"아래에 사물 한 점"});
  assert.notEqual(approved.formatApproval.key, revised.formatApproval.key);
  assert.match(imageCreativePrompt(revised, req), /아래에 사물 한 점/);
  assert.equal(imageCreativePrompt(approved, req), prompt);
  const changed = approveImageFormat(approved, {...req,formatIds:["typography"]}, stamp);
  assert.equal(changed.formatRecommendation.referenceSnapshot, undefined);
  assert.doesNotMatch(imageCreativePrompt(changed, {...req,formatIds:["typography"]}), /위쪽에 주인공 한 명/);
});

test("같은 항목의 유효한 보관 JPEG만 제공하고 공식 링크와 원문 버전을 보존한다", async () => {
  const data = await sharp({create:{width:2,height:3,channels:3,background:"#ffffff"}}).jpeg().toBuffer();
  const jpeg = "data:image/jpeg;base64," + data.toString("base64");
  const extract = value => referenceCatalogFromDocs([{...chapter, content_md:chapter.content_md.replace("## A22", "[보관원본]: " + value + "\n## A22")}]).entries;
  const [saved, other] = extract(jpeg);
  assert.equal(saved.archivedThumbnail, jpeg);
  assert.equal(saved.thumbnail, "https://example.org/preview.webp");
  assert.equal(saved.source, "https://example.org/original");
  assert.equal(saved.version, chapter.current_version);
  const withOriginal = chapter.content_md.replace("## A22","- 제작 원본 · [다운로드](https://example.org/full.png)\n## A22");
  const [large, next] = referenceCatalogFromDocs([{...chapter,content_md:withOriginal}]).entries;
  assert.equal(large.originalImageUrl,"https://example.org/full.png");
  assert.equal(large.thumbnail,saved.thumbnail);
  assert.equal(next.originalImageUrl,undefined);
  assert.equal(other.archivedThumbnail, undefined);
  for (const invalid of [jpeg.replace("jpeg","html"), jpeg.slice(0,-8), jpeg + "%%", "data:image/jpeg;base64," + "A".repeat(180000)]) {
    const [entry] = extract(invalid);
    assert.equal(entry.archivedThumbnail, undefined);
    assert.equal(entry.thumbnail, saved.thumbnail);
  }
});

test("an archived master belongs only to the matching warehouse entry and is read without executing its contents", () => {
  const recipe = '{"format":"os-reference-master/1","sha256":"invalid until matched against actual photo"}';
  const md = chapter.content_md.replace("## A22", ["\x60\x60\x60os-reference-master",recipe,"\x60\x60\x60","## A22"].join("\n"));
  const [withMaster,ordinary] = referenceCatalogFromDocs([{...chapter,content_md:md}]).entries;
  assert.equal(withMaster.masterRecipe,recipe);
  assert.equal(ordinary.masterRecipe,undefined);
});
