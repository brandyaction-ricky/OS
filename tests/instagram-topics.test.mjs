import assert from "node:assert/strict";
import test from "node:test";
import { citedUrls, formatCandidates, outputText, validateCandidates } from "../lib/instagram-topics.ts";

const urls = ["https://example.org/one", "https://example.org/two", "https://example.org/three"];
const candidate = (index) => ({
  title: `주제 ${index}`, hook: `첫 문장 ${index}`, audienceNeed: "고객 문제", angle: "핵심 관점",
  format: "캐러셀", whyNow: "최근 자료", evidence: "자료에서 확인한 내용",
  sourceUrl: urls[index - 1], cta: "프로필 링크에서 더 보기",
});

test("research citations are drawn from web search annotations", () => {
  const response = { output: [{ content: [{ type: "output_text", text: "자료" , annotations: [
    { type: "url_citation", url: urls[0] }, { type: "url_citation", url: urls[1] },
  ] }] }] };
  assert.deepEqual(citedUrls(response), urls.slice(0, 2));
  assert.equal(outputText(response), "자료");
});

test("exactly three distinct candidates with searched sources are required", () => {
  const valid = { candidates: [candidate(1), candidate(2), candidate(3)] };
  assert.equal(validateCandidates(valid, urls).length, 3);
  assert.match(formatCandidates(valid.candidates), /출처: https:\/\/example.org\/one/);
  assert.throws(() => validateCandidates({ candidates: valid.candidates.slice(0, 2) }, urls), /INVALID_CANDIDATE_COUNT/);
  assert.throws(() => validateCandidates({ candidates: [candidate(1), candidate(1), candidate(3)] }, urls), /DUPLICATE_CANDIDATES/);
  assert.throws(() => validateCandidates({ candidates: [candidate(1), candidate(2), { ...candidate(3), sourceUrl: "https://unknown.example" }] }, urls), /UNVERIFIED_SOURCE/);
});
