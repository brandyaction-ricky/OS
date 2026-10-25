// SEO 칼럼 (정본 「SEO 칼럼 만드는 절차」, owner request 2026-10-25): the HTML class contract the staff AI writes to, the OS check,
// and the design the OS puts on when the column is shown or exported. The stored HTML holds only the content; the CSS, the
// side 목차, JSON-LD and the images are added at show time, so a design change reaches every column at once (the earlier
// 기획실 studio_core.py `_gen_column_prompt` · `COLUMN_STYLE` · `_column_enrich` · `set_deriv_image`, carried over as they were).
import { parseYoutubeRef } from "./youtube-process/project.ts";

export const COLUMN_IMAGE_SLOTS = ["hero", "1", "2", "3"] as const;
export type ColumnImageSlot = (typeof COLUMN_IMAGE_SLOTS)[number];
export interface ColumnMeta { title: string; description: string; keywords: string[]; slug: string }
export interface ColumnSlotInfo { slot: string; kind: "hero" | "image" | "video"; prompt: string; caption: string }
/** What goes into a slot when shown: an image address (or data: URI on export), or a YouTube link for the video slot. */
export interface ColumnFill { src: string; alt?: string }

const FIGURE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi;
const FORBIDDEN = /<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|link|base|frame|frameset|img|video|audio|source|foreignobject)\b/gi;

const attrsOf = (attrText: string) => {
  const out: Record<string, string> = {};
  for (const match of attrText.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  return out;
};
const hasClass = (attrs: Record<string, string>, name: string) => (attrs.class ?? "").split(/\s+/).includes(name);
const unescape = (text: string) => text.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textOf = (html: string) => unescape(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The AI's answer as one document: code fences and any words before <!DOCTYPE dropped. */
export function cleanColumnHtml(value: string) {
  let html = value.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "");
  const at = html.search(/<!doctype|<html/i);
  if (at > 0) html = html.slice(at);
  return html.trim();
}

function metaContent(html: string, name: string) {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = attrsOf(match[1]);
    if (attrs.name?.toLowerCase() === name) return unescape(attrs.content ?? "").trim();
  }
  return "";
}
export function columnMeta(html: string): ColumnMeta {
  return { title: textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""), description: metaContent(html, "description"),
    keywords: metaContent(html, "keywords").split(",").map(word => word.trim()).filter(Boolean), slug: metaContent(html, "slug") };
}

/** The image and video places in reading order, with their prompts and captions. */
export function columnSlots(html: string): ColumnSlotInfo[] {
  return [...html.matchAll(FIGURE)].flatMap(([, attrText, inner]) => {
    const attrs = attrsOf(attrText);
    const slot = attrs["data-slot"];
    if (!slot) return [];
    return [{ slot, kind: slot === "video" || hasClass(attrs, "video") ? "video" as const : slot === "hero" || hasClass(attrs, "hero") ? "hero" as const : "image" as const,
      prompt: unescape(attrs["data-prompt"] ?? "").trim(), caption: textOf(inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? "") }];
  });
}

/** The list items from a block's opening tag to its first </ul> (div.tldr / div.takeaways hold one list). */
function blockItems(html: string, cls: string) {
  const block = html.match(new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/ul>`, "i"));
  return block ? (block[1].match(/<li\b/gi) ?? []).length : null;
}
export function faqPairs(html: string) {
  const faq = html.match(/<section\b[^>]*class=["'][^"']*\bfaq\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? "";
  return [...faq.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map(([, q, a]) => ({ q: textOf(q), a: textOf(a) })).filter(pair => pair.q && pair.a);
}

/**
 * `unsafe`: what may not be shown at all (scripts, frames, styles, inline handlers) — always refused.
 * `issues`: what breaks the 정본 구성 — refused when the AI submits, shown as a warning when a person edits by hand.
 */
export function checkColumnHtml(html: string) {
  const unsafe = [...new Set([...html.matchAll(FORBIDDEN)].map(match => `<${match[1].toLowerCase()}>`))].map(tag => `${tag} 태그는 넣지 않아요`);
  if (/\son[a-z]+\s*=/i.test(html)) unsafe.push("on… 속성(스크립트)은 넣지 않아요");
  if (/(?:href|src|xlink:href)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i.test(html)) unsafe.push("javascript: · data: 주소는 넣지 않아요");
  if (/<meta\b[^>]*http-equiv/i.test(html)) unsafe.push("http-equiv meta는 넣지 않아요");
  if (html.length > 150_000) unsafe.push("HTML이 15만 자를 넘어요");

  const issues: string[] = [];
  const meta = columnMeta(html);
  if (!/<head\b/i.test(html) || !/<body\b/i.test(html)) issues.push("<head>와 <body>가 있는 HTML 문서 하나로 써요");
  if (!meta.title) issues.push("<title>이 비어 있어요");
  if (meta.description.length < 60 || meta.description.length > 200) issues.push(`meta description은 150자 안팎(60~200자)이에요 — 지금 ${meta.description.length}자`);
  if (meta.keywords.length < 5 || meta.keywords.length > 8) issues.push(`meta keywords는 5~8개예요 — 지금 ${meta.keywords.length}개`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug) || meta.slug.length > 80) issues.push("meta slug는 영문 소문자·숫자·하이픈(80자 이내)이에요");
  if ((html.match(/<article\b[^>]*class=["'][^"']*\bba-article\b/gi) ?? []).length !== 1) issues.push("<article class=\"ba-article\">이 하나 있어야 해요");
  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  if (h1 !== 1) issues.push(`<h1>은 하나예요 — 지금 ${h1}개`);
  const tldr = blockItems(html, "tldr");
  if (tldr !== 3) issues.push(tldr === null ? "3줄 요약(div.tldr)이 없어요" : `3줄 요약은 <li> 3개예요 — 지금 ${tldr}개`);
  if (!/<p\b[^>]*class=["'][^"']*\blead\b/i.test(html)) issues.push("도입 문단(p.lead)이 없어요");
  const withoutFaq = html.replace(/<section\b[^>]*class=["'][^"']*\bfaq\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "");
  const h2 = (withoutFaq.match(/<h2\b/gi) ?? []).length;
  if (h2 < 4 || h2 > 7) issues.push(`본문 소제목(h2)은 4~7개예요 — 지금 ${h2}개`);
  const takeaways = blockItems(html, "takeaways");
  if (takeaways === null || takeaways < 3) issues.push(takeaways === null ? "핵심 정리(div.takeaways)가 없어요" : `핵심 정리는 <li> 3개 이상이에요 — 지금 ${takeaways}개`);
  const pairs = faqPairs(html).length;
  if (pairs < 3) issues.push(`FAQ(section.faq의 dt · dd)는 3쌍 이상이에요 — 지금 ${pairs}쌍`);

  const slots = columnSlots(html);
  const seen = new Set<string>();
  for (const info of slots) {
    if (seen.has(info.slot)) issues.push(`data-slot="${info.slot}"이 두 번 나와요`);
    seen.add(info.slot);
    if (info.kind === "video") continue;
    const name = info.slot === "hero" ? "대표 이미지" : `이미지 ${info.slot}`;
    const words = wordCount(info.prompt);
    if (words < 35 || words > 110) issues.push(`${name} data-prompt는 40~80단어 영어 문단이에요 — 지금 ${words}단어`);
    else if (!/16:9/.test(info.prompt) || !/no text/i.test(info.prompt)) issues.push(`${name} data-prompt에 16:9와 no text가 있어야 해요`);
    if (!info.caption) issues.push(`${name}의 figcaption(한글 설명)이 비어 있어요`);
  }
  if (!slots.some(info => info.slot === "hero" && info.kind === "hero")) issues.push("대표 이미지 자리(figure.ph.hero, data-slot=\"hero\")가 없어요");
  const images = slots.filter(info => ["1", "2", "3"].includes(info.slot)).length;
  if (images < 2 || images > 3) issues.push(`본문 이미지 자리(data-slot 1~3)는 2~3개예요 — 지금 ${images}개`);
  const other = slots.filter(info => !["hero", "1", "2", "3", "video"].includes(info.slot));
  if (other.length) issues.push(`data-slot은 hero · 1 · 2 · 3 · video만 써요 — ${other.map(info => info.slot).join(", ")}`);
  return { unsafe, issues, meta };
}

function filledFigure(attrText: string, inner: string, fill: ColumnFill) {
  const attrs = attrsOf(attrText);
  const slot = escape(attrs["data-slot"] ?? "");
  const prompt = escape(unescape(attrs["data-prompt"] ?? ""));
  const caption = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? "";
  const video = parseYoutubeRef(fill.src);
  if (video) return `<figure class="filled embed" data-slot="${slot}"><div class="col-embed"><iframe src="https://www.youtube.com/embed/${video.videoId}" title="${escape(textOf(caption) || "영상")}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div><figcaption>${caption}</figcaption></figure>`;
  const hero = hasClass(attrs, "hero") || attrs["data-slot"] === "hero";
  return `<figure class="filled${hero ? " hero" : ""}" data-slot="${slot}" data-prompt="${prompt}"><img src="${escape(fill.src)}" alt="${escape(fill.alt || textOf(caption))}"><figcaption>${caption}</figcaption></figure>`;
}

/** The column with its places filled, h2/h3 anchors, the side 목차 and its JSON-LD (Article · FAQPage), before it becomes a page. */
function columnParts(html: string, fills: Partial<Record<string, ColumnFill>>) {
  let doc = cleanColumnHtml(html).replace(/<style[\s\S]*?<\/style>/gi, "");
  doc = doc.replace(FIGURE, (whole, attrText: string, inner: string) => {
    const fill = fills[attrsOf(attrText)["data-slot"] ?? ""];
    return fill?.src ? filledFigure(attrText, inner, fill) : whole;
  });
  if (!/<body\b/i.test(doc)) doc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"></head><body>${doc}</body></html>`;
  const meta = columnMeta(doc);
  const toc: { tag: string; id: string; label: string }[] = [];
  doc = doc.replace(/<(h2|h3)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_, tag: string, attrText: string, inner: string) => {
    const id = attrsOf(attrText).id || `sec-${toc.length + 1}`;
    toc.push({ tag: tag.toLowerCase(), id, label: textOf(inner) });
    return `<${tag}${attrsOf(attrText).id ? attrText : `${attrText} id="${id}"`}>${inner}</${tag}>`;
  });
  const items = toc.filter(item => item.label);
  const nav = items.length >= 3 ? `<nav class="col-toc" aria-label="목차"><div class="col-toc-h">목차</div><ul>${items.map(item => `<li class="t-${item.tag}"><a href="#${escape(item.id)}">${escape(item.label)}</a></li>`).join("")}</ul></nav>` : "";
  const pairs = faqPairs(doc);
  // An image sent to MYIN is named "myin-image:<key>" until MYIN stores it and puts its public address in (also inside JSON-LD).
  const hero = fills.hero?.src && /^(https:\/\/|myin-image:)/.test(fills.hero.src) ? { image: fills.hero.src } : {};
  const ld = [{ "@context": "https://schema.org", "@type": "Article", headline: meta.title, description: meta.description, inLanguage: "ko", keywords: meta.keywords.join(", "),
    author: { "@type": "Organization", name: "브랜디액션" }, publisher: { "@type": "Organization", name: "브랜디액션" }, ...hero },
  ...(pairs.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: pairs.map(pair => ({ "@type": "Question", name: pair.q, acceptedAnswer: { "@type": "Answer", text: pair.a } })) }] : [])];
  return { doc, nav, ld, meta };
}

/** The column as a page: slots filled, h2/h3 anchors with the side 목차, JSON-LD (Article · FAQPage) and the design CSS. */
export function renderColumn(html: string, fills: Partial<Record<string, ColumnFill>> = {}) {
  const { nav, ld, doc: body } = columnParts(html, fills);
  let doc = body;
  const head = `${COLUMN_STYLE}${ld.map(item => `<script type="application/ld+json">${JSON.stringify(item).replace(/</g, "\\u003c")}</script>`).join("")}`;
  doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, `${head}</head>`) : doc.replace(/<body\b/i, `<head>${head}</head><body`);
  return doc.replace(/(<body\b[^>]*>)([\s\S]*?)(<\/body>)/i, (_, open: string, inner: string, close: string) => `${open}<div class="col-wrap">${nav}${inner}</div>${TOC_SPY}${close}`);
}

/**
 * The column for the MYIN 아티클 page (owner request 2026-10-25): the body only — 목차 and the article, no page shell, style or
 * script (MYIN keeps the design and renders the JSON-LD itself) — with its title, description and slug.
 */
export function columnForMyin(html: string, fills: Partial<Record<string, ColumnFill>>) {
  const { doc, nav, ld, meta } = columnParts(html, fills);
  const body = (doc.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? doc).trim();
  return { meta, html: `<div class="col-wrap">${nav}${body}</div>`, jsonLd: ld };
}

/** The column page's 목차 highlight (the earlier 기획실 one): the section being read is marked in the side list. */
const TOC_SPY = "<script>(function(){var ls=[].slice.call(document.querySelectorAll('.col-toc a'));if(!ls.length||!window.IntersectionObserver)return;var map={};ls.forEach(function(a){map[a.getAttribute('href')]=a;});var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){ls.forEach(function(a){a.classList.remove('active')});var a=map['#'+e.target.id];if(a)a.classList.add('active')}})},{rootMargin:'0px 0px -72% 0px'});Object.keys(map).forEach(function(h){var e=document.getElementById(h.slice(1));if(e)io.observe(e)})})();</script>";

/** The HTML the staff AI writes (job card): the earlier 기획실 contract — the 정본 keeps the content rules, this keeps the class names. */
export const COLUMN_CONTRACT = `**완결된 HTML 문서 하나**를 result.html에 넣습니다. \`<!DOCTYPE html>\`부터 시작하고, 설명이나 코드펜스(\`\`\`)는 붙이지 않습니다.
\`<style>\` · \`<script>\` · \`<img>\` · \`<iframe>\` · on… 속성은 넣지 않습니다(디자인 · 목차 · 구조화 데이터 · 이미지는 OS가 보여줄 때 입힙니다). 아래 class를 그대로 씁니다.

<head>: <title>제목</title> · <meta name="description" content="약 150자"> · <meta name="keywords" content="키워드 5~8개, 쉼표로"> · <meta name="slug" content="영문-소문자-슬러그">
<body>에 \`<article class="ba-article">\` 하나, 그 안에 이 순서로:
1. \`<h1>\` 제목 (하나)
2. 대표 이미지 자리 — h1 바로 아래: \`<figure class="ph hero" data-slot="hero" data-prompt="글 전체를 상징하는 가로 와이드 대표 이미지의 완결 영어 프롬프트"><div class="ico">🖼️</div><figcaption>[대표 이미지] 한글 설명</figcaption></figure>\`
3. \`<div class="tldr"><b>3줄 요약</b><ul><li>…</li><li>…</li><li>…</li></ul></div>\` — 핵심 질문 직답(AEO), <li> 정확히 3개
4. \`<p class="lead">\` 도입 한 문단
5. 본문 \`<h2>\` 4~7개, 섹션마다 \`<p>\`. 긴 섹션은 \`<h3>\` 2~3개로 나눕니다. 내용에 맞을 때만 섞습니다:
   - \`<aside class="callout"><div class="t">라벨</div><p>핵심 정의 · 팁</p></aside>\`
   - \`<blockquote>인용할 만한 단정적 문장</blockquote>\`
   - \`<table class="cmp"><thead><tr><th>…</th></tr></thead><tbody>…</tbody></table>\` (비교가 있을 때)
   - \`<ol>\` · \`<ul>\` (단계 · 항목)
6. 본문 이미지 자리 2~3개(본문 사이 알맞은 곳): \`<figure class="ph" data-slot="1" data-prompt="…"><div class="ico">🖼️</div><figcaption>[이미지] 한글 설명</figcaption></figure>\` — data-slot은 1 · 2 · 3
   data-prompt는 그대로 이미지 AI에 붙여 넣어 바로 뽑히는 **완결 영어 문단(40~80단어)**: 장면 · 구도 · 아트 스타일 · 색(navy #0D1531 · blue #2735C8, 밝은 배경 #F7F8FF) · 분위기 · "16:9 aspect ratio. No text, no words, no logos."
7. (선택) 영상 자리 하나 — 영상이 도움 될 때만: \`<figure class="ph video" data-slot="video"><div class="ico">▶️</div><figcaption>[영상] 이 롱폼 자리</figcaption></figure>\` (OS가 올린 유튜브 영상을 넣습니다)
8. (선택) 개념이 도식으로 잘 보이면 간단한 인라인 SVG 하나: \`<figure><svg viewBox="0 0 640 …" role="img" aria-label="…">…</svg><figcaption>…</figcaption></figure>\` (글자 · 사각형 · 화살표 정도, 네이비 · 블루, 흰 배경)
9. \`<div class="takeaways"><div class="t">핵심 정리</div><ul><li>…</li>…</ul></div>\` — <li> 3개 이상
10. \`<section class="faq"><h2>자주 묻는 질문</h2><dl><dt>질문</dt><dd>답</dd>…</dl></section>\` — 3쌍 이상, 질문/답 쌍으로`;

/** The design (earlier 기획실 COLUMN_STYLE), put on at show time only. */
export const COLUMN_STYLE = `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Serif+KR:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
:root{--ink:#171A22;--ink-soft:#303642;--navy:#0D1531;--blue:#2735C8;--blue-deep:#17228F;--blue-soft:#EEF0FF;--blue-wash:#F7F8FF;--paper:#F2F4F8;--card:#FFF;--line:#E1E5EE;--line-strong:#CDD3E0;--muted:#626B79;--muted-2:#7B8492;--radius:20px;--shadow:0 18px 50px rgba(13,21,49,.08);--shadow-soft:0 8px 28px rgba(13,21,49,.06);--serif:'Noto Serif KR','Nanum Myeongjo',serif;--sans:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;--mono:'IBM Plex Mono',ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font-family:var(--sans);font-size:16.5px;line-height:1.82;letter-spacing:-.015em;-webkit-font-smoothing:antialiased;background:radial-gradient(circle at 8% 0%,rgba(39,53,200,.06),transparent 30rem),var(--paper)}
.ba-article{max-width:760px;margin:34px auto;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:52px 52px 66px}
.ba-article>h1{font-family:var(--serif);font-weight:700;font-size:clamp(28px,4.4vw,40px);line-height:1.32;letter-spacing:-.04em;color:var(--navy);margin:0 0 22px}
.ba-article h2{font-family:var(--serif);font-weight:700;font-size:24px;line-height:1.42;letter-spacing:-.03em;color:var(--navy);margin:46px 0 14px}
.ba-article h3{font-family:var(--serif);font-weight:700;font-size:19px;line-height:1.5;color:var(--navy);margin:30px 0 10px}
.ba-article p{margin:0 0 17px;color:var(--ink-soft)}
.ba-article .lead{font-size:18px;color:var(--ink);line-height:1.9}
strong{color:var(--navy)}a{color:var(--blue)}
.tldr{background:var(--blue-wash);border:1px solid #E1E5F7;border-radius:14px;padding:20px 24px;margin:0 0 32px}
.tldr b{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--blue);margin-bottom:10px}
.tldr ul{margin:0;padding-left:20px}.tldr li{margin:7px 0;color:var(--ink-soft)}
.callout{background:var(--blue-soft);border-left:4px solid var(--blue);border-radius:0 14px 14px 0;padding:17px 22px;margin:24px 0}
.callout .t{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--blue-deep);margin-bottom:6px}
.callout p{margin:0;color:var(--ink-soft)}
blockquote{background:var(--navy);color:#F5F6FF;border-radius:13px;padding:32px 36px;margin:28px 0;box-shadow:var(--shadow);font-family:var(--serif);font-weight:600;font-size:clamp(19px,2.5vw,25px);line-height:1.65;letter-spacing:-.03em}
blockquote p{margin:0}
table.cmp{width:100%;border-collapse:collapse;margin:26px 0;font-size:15px;box-shadow:var(--shadow-soft);border-radius:10px;overflow:hidden}
table.cmp th,table.cmp td{border:1px solid var(--line);padding:13px 15px;text-align:left;vertical-align:top}
table.cmp th{background:var(--navy);color:#EEF0FF;font-weight:600}
table.cmp tr:nth-child(even) td{background:var(--blue-wash)}
figure{margin:30px 0}
figure.ph{border:1.5px dashed var(--line-strong);border-radius:14px;background:var(--blue-wash);padding:40px 22px;text-align:center;color:var(--muted-2)}
figure.ph .ico{font-size:30px;opacity:.7}
figure.ph figcaption{font-family:var(--mono);font-size:12px;letter-spacing:.02em;margin-top:12px;color:var(--muted)}
figure svg{max-width:100%;height:auto;display:block;margin:0 auto}
figure.filled img{max-width:100%;height:auto;display:block;margin:0 auto;border-radius:14px;box-shadow:var(--shadow-soft)}
figure>figcaption{font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;color:var(--muted-2);text-align:center;margin-top:12px}
.takeaways{position:relative;overflow:hidden;background:var(--navy);color:#EAECFF;border-radius:var(--radius);padding:26px 30px;margin:38px 0;box-shadow:var(--shadow)}
.takeaways::after{content:"";position:absolute;width:220px;height:220px;border-radius:50%;right:-110px;top:-130px;border:1px solid rgba(255,255,255,.10)}
.takeaways .t{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9FACF0;margin-bottom:12px}
.takeaways ul{margin:0;padding-left:20px;position:relative;z-index:1}
.takeaways li{margin:9px 0;line-height:1.6}
.takeaways strong,.takeaways b{color:#AAB4FF}blockquote strong,blockquote b{color:#C7CEFF}table.cmp th strong,table.cmp th b{color:#FFF}
.faq{margin-top:46px;border-top:1px solid var(--line);padding-top:26px}
.faq h2{font-family:var(--serif);font-size:22px;color:var(--navy);margin:0 0 4px}
.faq dt{font-family:var(--serif);font-weight:700;color:var(--navy);margin:20px 0 6px;font-size:17px}
.faq dd{margin:0;color:var(--ink-soft)}
ul,ol{padding-left:22px}li{margin:7px 0}
html{scroll-behavior:smooth;scroll-padding-top:24px}
.col-wrap{display:flex;gap:38px;align-items:flex-start;justify-content:center;padding:0 20px}
.col-toc{position:sticky;top:26px;flex:0 0 214px;max-height:calc(100vh - 52px);overflow:auto;margin-top:46px;font-family:var(--sans);font-size:13px}
.col-toc .col-toc-h{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--blue);margin:0 0 12px 14px}
.col-toc ul{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}
.col-toc li{margin:0}
.col-toc li a{display:block;padding:6px 14px;color:var(--muted);text-decoration:none;line-height:1.45;border-left:2px solid transparent;margin-left:-2px;transition:.12s}
.col-toc li a:hover{color:var(--blue)}
.col-toc li.t-h3 a{padding-left:28px;font-size:12px;color:var(--muted-2)}
.col-toc a.active{color:var(--navy);font-weight:700;border-left-color:var(--blue)}
figure.hero{margin:0 0 30px}figure.hero img{width:100%;border-radius:14px;box-shadow:var(--shadow-soft)}
figure.hero.ph{padding:64px 22px}
figure.video .ico{color:var(--blue)}
.col-embed{position:relative;padding-top:56.25%;border-radius:14px;overflow:hidden;box-shadow:var(--shadow-soft)}
.col-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
@media(max-width:960px){.col-wrap{display:block;padding:0}.col-toc{position:static;max-height:none;flex:none;margin:22px auto 0;max-width:760px;padding:16px 20px;background:var(--blue-wash);border-radius:14px}.col-toc ul{border-left:none}.col-toc li.t-h3 a{padding-left:22px}}
@media(max-width:640px){.ba-article{margin:16px auto;padding:30px 20px 40px;border-radius:14px}}
</style>`;
