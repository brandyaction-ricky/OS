import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as scriptCheck from "../lib/youtube-script-check.ts";
import * as narration from "../lib/youtube-narration-document.ts";
import * as project from "../lib/youtube-process/project.ts";
import * as stages from "../lib/youtube-process/stages.ts";
import * as seoColumn from "../lib/seo-column.ts";

// SEO 칼럼 by the staff AI (owner request 2026-10-25): opens after the 최종 검수 OK, stores only checked HTML, and never overwrites a column a person edited.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = await readFile(new URL("../lib/server/youtube-process-ai.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
let written = null;
const assertColumnOpen = (row) => {
  if (row.yp.topic.type === "short") throw new ApiError(409, "STAGE_LOCKED", "숏폼에는 SEO 칼럼이 없어요.");
  if (!["upload", "shorts", "done"].includes(row.yp.stage)) throw new ApiError(409, "STAGE_LOCKED", "최종 검수 컨펌 OK 뒤에 SEO 칼럼을 만들 수 있어요.");
};
const modules = { "node:crypto": crypto, zod, "@/lib/http": { ApiError }, "@/lib/youtube-script-check": scriptCheck, "@/lib/youtube-narration-document": narration,
  "@/lib/youtube-process/project": project, "@/lib/youtube-process/stages": stages, "@/lib/seo-column": seoColumn,
  "./content-generation": { procedureRefs: async () => [{ id: "93da68b1", title: "SEO 칼럼 만드는 절차 (정본)" }] },
  "./youtube-process-stages": { assertColumnOpen, writeStage: async (_supabase, _actor, _team, _project, kind, current, data) => { written = { kind, current, data }; return { id: "col", version: current.version + 1 }; } } };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => modules[name] });
const ai = compiled.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const prompt = `Editorial flat vector illustration of a notebook on a wide desk with soft daylight and a young Korean professional thinking. Centered composition, wide shot, generous negative space at top. Minimalist palette of deep navy (#0D1531) and vivid blue (#2735C8) on a light off-white background (#F7F8FF). Calm, professional mood, soft even lighting. 16:9 aspect ratio. No text, no words, no logos.`;
const column = (title = "사업계획서의 순서") => `<!DOCTYPE html><html lang="ko"><head><title>${title}</title><meta name="description" content="${"처음 사업계획서를 쓸 때는 양식보다 순서가 먼저입니다. ".repeat(3)}">
<meta name="keywords" content="사업계획서, 순서, 창업, 문제 정의, 고객"><meta name="slug" content="business-plan-order"></head><body><article class="ba-article"><h1>${title}</h1>
<figure class="ph hero" data-slot="hero" data-prompt="${prompt}"><figcaption>[대표 이미지] 노트</figcaption></figure>
<div class="tldr"><b>3줄 요약</b><ul><li>a</li><li>b</li><li>c</li></ul></div><p class="lead">도입</p>
<h2>하나</h2><p>.</p><h2>둘</h2><p>.</p><h2>셋</h2><p>.</p><h2>넷</h2><p>.</p>
<figure class="ph" data-slot="1" data-prompt="${prompt}"><figcaption>[이미지] 하나</figcaption></figure><figure class="ph" data-slot="2" data-prompt="${prompt}"><figcaption>[이미지] 둘</figcaption></figure>
<div class="takeaways"><div class="t">핵심 정리</div><ul><li>a</li><li>b</li><li>c</li></ul></div>
<section class="faq"><h2>자주 묻는 질문</h2><dl><dt>q1</dt><dd>a1</dd><dt>q2</dt><dd>a2</dd><dt>q3</dt><dd>a3</dd></dl></section></article></body></html>`;
const now = "2026-10-25T00:00:00Z";
const record = (id, extra) => ({ id, version: 1, archived_at: null, created_at: now, owner_id: "owner", metadata: {}, ...extra });
const state = (stage, columnData, kind = "anim") => ({
  source: record("project", { title: "사업계획서", team: "콘텐츠", metadata: { workflow: "youtube_v1", yp: { ...project.newProjectMeta({ type: kind, target: "1인 창업 준비자", note: "", refs: [] }, now).yp, stage } } }),
  records: [
    record("outline", { record_type: "content_script", metadata: { scriptKind: "yp_outline", yp: { ...stages.emptyStage("outline", kind), script: "## 오프닝\n\n처음 사업계획서를 쓸 때 막히는 이유는 순서입니다.\n" } } }),
    record("upload", { record_type: "content_package", metadata: { packageKind: "yp_upload", yp: { ...stages.emptyStage("upload", kind), run: { at: now, by: "리키", status: "done", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } } } }),
    ...(columnData ? [record("column", { record_type: "content_package", metadata: { packageKind: "yp_column", yp: columnData } })] : []),
  ],
});
const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: "리키" } }) }) }) }) };
const author = { model: "claude-opus-5-5", jobId: "job", name: "키 이름" };

test("the column opens after the 최종 검수 OK, for longform only, and needs the 원고", () => {
  assert.throws(() => ai.assertV1ColumnInputs(state("review")), (error) => error.status === 409);
  assert.throws(() => ai.assertV1ColumnInputs(state("upload", null, "short")), (error) => error.status === 409);
  assert.doesNotThrow(() => ai.assertV1ColumnInputs(state("shorts")));
  // The key moves with the uploaded video, so a job written before the upload is closed.
  const after = state("shorts"); after.records[1].metadata.yp.run.videoUrl = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  assert.notEqual(ai.v1ColumnInputKey(state("shorts")), ai.v1ColumnInputKey(after));
});

test("the job card points at the 정본 by doc_id, carries the class contract and the 원고 as data", async () => {
  const card = await ai.v1ColumnCard({}, state("shorts"), 45);
  assert.match(card, /SEO 칼럼 만드는 절차 \(정본\) \(doc_id: 93da68b1\)/);
  assert.match(card, /class="ba-article"/);
  assert.match(card, /처음 사업계획서를 쓸 때 막히는 이유는 순서입니다/);
  assert.match(card, /"videoUrl": "https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
});

test("an AI column fills an empty column; a column a person edited keeps its HTML and gets the draft beside it", async () => {
  await assert.rejects(ai.saveV1Column(supabase, "owner", state("shorts"), { html: "<p>짧음</p>" }, author), (error) => error.status === 422 && /칼럼 검사/.test(error.message));
  await assert.rejects(ai.saveV1Column(supabase, "owner", state("shorts"), { html: column().replace("</article>", "<script>x()</script></article>") }, author), (error) => error.status === 422);

  const first = await ai.saveV1Column(supabase, "owner", state("shorts"), { html: "```html\n" + column() + "\n```" }, author);
  assert.deepEqual(plain(first).replaced, true);
  assert.equal(written.kind, "column");
  assert.ok(written.data.html.startsWith("<!DOCTYPE html>"));
  assert.equal(written.data.ai.by, "리키");
  assert.equal(written.data.ai.html, written.data.html);

  // Untouched AI column: the next draft replaces it.
  const untouched = { html: written.data.html, fills: { hero: { url: "https://cdn.example.com/a.png" } }, ai: written.data.ai };
  await ai.saveV1Column(supabase, "owner", state("shorts", untouched), { html: column("새 제목") }, author);
  assert.match(written.data.html, /새 제목/);
  assert.equal(written.data.aiDraft, undefined);
  assert.deepEqual(plain(written.data.fills), { hero: { url: "https://cdn.example.com/a.png" } });

  // Edited by a person: kept, the draft waits beside it.
  const edited = { ...untouched, html: untouched.html.replace("<p class=\"lead\">도입</p>", "<p class=\"lead\">사람이 고친 도입</p>") };
  await ai.saveV1Column(supabase, "owner", state("shorts", edited), { html: column("세 번째") }, author);
  assert.match(written.data.html, /사람이 고친 도입/);
  assert.match(written.data.aiDraft, /세 번째/);
});
