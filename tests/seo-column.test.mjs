import assert from "node:assert/strict";
import test from "node:test";
import { checkColumnHtml, cleanColumnHtml, columnForMyin, columnSlots, faqPairs, renderColumn } from "../lib/seo-column.ts";
import { columnSignature } from "../lib/youtube-process/stages.ts";

// SEO 칼럼 (owner request 2026-10-25): the earlier 기획실 class contract, checked by the OS and dressed only when shown.
const prompt = (scene) => `Editorial flat vector illustration of ${scene}, a young Korean professional at a wide desk with soft daylight. Centered composition, wide shot, generous negative space at top. Minimalist palette of deep navy (#0D1531) and vivid blue (#2735C8) on a light off-white background (#F7F8FF). Calm, thoughtful, professional mood, soft even lighting. 16:9 aspect ratio. No text, no words, no logos in the image.`;
const section = (n) => `<h2>소제목 ${n}</h2><p>본문 ${n}</p>`;
const column = ({ h2 = 5, images = 2, tldr = 3, extra = "" } = {}) => `<!DOCTYPE html><html lang="ko"><head><title>그릇 큰 사람의 특징</title>
<meta name="description" content="${"그릇이 크다는 건 지식이 많은 게 아니라 자신이 무엇을 모르는지 아는 것입니다. ".repeat(3)}">
<meta name="keywords" content="그릇, 자기인식, 약점, 경청, 여유">
<meta name="slug" content="big-hearted-self-awareness"></head>
<body><article class="ba-article"><h1>그릇 큰 사람의 특징</h1>
<figure class="ph hero" data-slot="hero" data-prompt="${prompt("an open bowl")}"><div class="ico">🖼️</div><figcaption>[대표 이미지] 여백 있는 그릇</figcaption></figure>
<div class="tldr"><b>3줄 요약</b><ul>${"<li>요약</li>".repeat(tldr)}</ul></div>
<p class="lead">도입 문단</p>
${Array.from({ length: h2 }, (_, i) => section(i + 1)).join("")}
${Array.from({ length: images }, (_, i) => `<figure class="ph" data-slot="${i + 1}" data-prompt="${prompt(`scene ${i + 1}`)}"><div class="ico">🖼️</div><figcaption>[이미지] 장면 ${i + 1}</figcaption></figure>`).join("")}
<figure class="ph video" data-slot="video"><div class="ico">▶️</div><figcaption>[영상] 이 롱폼</figcaption></figure>
${extra}
<div class="takeaways"><div class="t">핵심 정리</div><ul><li>하나</li><li>둘</li><li>셋</li></ul></div>
<section class="faq"><h2>자주 묻는 질문</h2><dl><dt>그릇이 크다는 건?</dt><dd>모르는 걸 아는 것입니다.</dd><dt>둘</dt><dd>답 둘</dd><dt>셋</dt><dd>답 셋</dd></dl></section>
</article></body></html>`;

test("a column in the 정본 구성 passes; the slots read in order with their prompts", () => {
  const result = checkColumnHtml(column());
  assert.deepEqual(result.unsafe, []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.meta.slug, "big-hearted-self-awareness");
  assert.equal(result.meta.keywords.length, 5);
  assert.deepEqual(columnSlots(column()).map(slot => [slot.slot, slot.kind]), [["hero", "hero"], ["1", "image"], ["2", "image"], ["video", "video"]]);
  assert.equal(faqPairs(column()).length, 3);
});

test("the check names every place that breaks the 구성 (h2 count without the FAQ, 3줄 요약, image places)", () => {
  const { issues } = checkColumnHtml(column({ h2: 3, images: 1, tldr: 2 }));
  assert.ok(issues.some(issue => issue.includes("h2") && issue.includes("3개")), issues.join(" / "));
  assert.ok(issues.some(issue => issue.includes("3줄 요약") && issue.includes("2개")));
  assert.ok(issues.some(issue => issue.includes("본문 이미지 자리") && issue.includes("1개")));
  const short = checkColumnHtml(column().replace(prompt("scene 1"), "a desk"));
  assert.ok(short.issues.some(issue => issue.startsWith("이미지 1 data-prompt")));
});

test("scripts, frames, styles, handlers and javascript: links are refused outright", () => {
  for (const bad of ["<script>alert(1)</script>", "<iframe src=\"https://x\"></iframe>", "<style>p{}</style>", "<p onclick=\"x()\">x</p>", "<a href=\"javascript:x()\">x</a>", "<img src=\"https://x/y.png\">", "<svg><foreignObject></foreignObject></svg>"]) {
    assert.ok(checkColumnHtml(column({ extra: bad })).unsafe.length > 0, bad);
  }
  assert.deepEqual(checkColumnHtml(column({ extra: "<figure><svg viewBox=\"0 0 640 200\" role=\"img\" aria-label=\"도식\"><rect width=\"10\" height=\"10\"/></svg><figcaption>도식</figcaption></figure>" })).unsafe, []);
});

test("an answer wrapped in a code fence or prose is cut to the document", () => {
  assert.ok(cleanColumnHtml("여기 있어요\n```html\n<!DOCTYPE html><html></html>\n```").startsWith("<!DOCTYPE html>"));
});

test("shown: design CSS, side 목차 from h2/h3, JSON-LD Article + FAQPage, slots filled with an image or the YouTube video", () => {
  const page = renderColumn(column(), { hero: { src: "https://cdn.example.com/hero.png" }, video: { src: "https://youtu.be/dQw4w9WgXcQ" } });
  assert.match(page, /<style>[\s\S]*\.ba-article/);
  assert.match(page, /<nav class="col-toc"[\s\S]*href="#sec-1"/);
  assert.match(page, /<h2 id="sec-1">/);
  const ld = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.deepEqual(ld.map(item => item["@type"]), ["Article", "FAQPage"]);
  assert.equal(ld[0].image, "https://cdn.example.com/hero.png");
  assert.equal(ld[1].mainEntity.length, 3);
  assert.match(page, /<figure class="filled hero" data-slot="hero"[^>]*><img src="https:\/\/cdn\.example\.com\/hero\.png"/);
  assert.match(page, /<iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
  // An empty place stays a placeholder with its prompt; the stored HTML itself is never changed.
  assert.match(page, /<figure class="ph" data-slot="1" data-prompt=/);
});

test("JSON-LD cannot close its own script tag", () => {
  const page = renderColumn(column().replace("<title>그릇 큰 사람의 특징</title>", "<title>a &lt;/script&gt; b</title>"));
  const ld = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.ok(!ld.includes("</"));
  assert.equal(JSON.parse(ld).headline, "a </script> b");
});

// 마이인 칼럼 (owner request 2026-10-25): MYIN gets the body only — 목차 and article, no page shell, style or script — with the
// JSON-LD apart, and uploaded images named "myin-image:<key>" for MYIN to store and point at.
test("the MYIN column is the body only, with its JSON-LD apart and uploaded images named for MYIN", () => {
  const sent = columnForMyin(column(), { hero: { src: "myin-image:img-hero" }, video: { src: "https://youtu.be/dQw4w9WgXcQ" } });
  assert.match(sent.html, /^<div class="col-wrap"><nav class="col-toc"/);
  assert.doesNotMatch(sent.html, /<(html|head|body|style|script|title|meta)\b/i);
  assert.match(sent.html, /<article class="ba-article"><h1>그릇 큰 사람의 특징<\/h1>/);
  assert.match(sent.html, /<img src="myin-image:img-hero"/);
  assert.match(sent.html, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  assert.deepEqual(sent.jsonLd.map(item => item["@type"]), ["Article", "FAQPage"]);
  assert.equal(sent.jsonLd[0].image, "myin-image:img-hero");
  assert.deepEqual([sent.meta.slug, sent.meta.title], ["big-hearted-self-awareness", "그릇 큰 사람의 특징"]);
});

test("a column's fingerprint changes with its HTML or its places, not with the order places were filled", () => {
  const item = { html: column(), fills: { hero: { path: "a.png" }, 1: { url: "https://x.test/1.png" } } };
  assert.equal(columnSignature(item), columnSignature({ html: item.html, fills: { 1: { url: "https://x.test/1.png" }, hero: { path: "a.png" } } }));
  assert.notEqual(columnSignature(item), columnSignature({ ...item, html: item.html.replace("본문 1", "본문 하나") }));
  assert.notEqual(columnSignature(item), columnSignature({ ...item, fills: { hero: { path: "b.png" } } }));
});
