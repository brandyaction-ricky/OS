import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/development-handoff.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadedModule = { exports: {} };
runInNewContext(`(function(module, exports) { ${code}\n})`, { URL })(loadedModule, loadedModule.exports);
const { buildDevelopmentHandoff, recordText, repositoryUrl, safeWebUrl } = loadedModule.exports;

const project = {
  id: "1ec743ea-0437-4d9f-8b49-fca01b2ddbea",
  title: "테스트 프로젝트",
  description: "직원 요청을 기록하고 해결 결과를 확인하는 업무 공간",
  metadata: { repository: "example-company/internal-os", productionUrl: "https://os.example.com" },
};
const request = {
  id: "5c27e3c3-cfd5-4323-b95e-697b63d28716",
  parent_id: project.id,
  title: "검색 필터가 저장되지 않음",
  description: "상태 필터를 선택하고 새로고침하면 선택이 사라집니다.",
  priority: "high",
  version: 4,
  metadata: {
    pageUrl: "https://os.example.com/knowledge/search",
    category: "bug",
    steps: "1. 검토 상태 선택\n2. 새로고침",
    expectedResult: "새로고침 후에도 선택한 상태 필터 유지",
    attachmentUrl: "https://os.example.com/files/screenshot.png",
    resolution: "초기 분석: URL의 검색 조건 복원 여부 확인 필요",
  },
};

test("request handoff identifies the project, source request version and repository", () => {
  const prompt = buildDevelopmentHandoff(project, request);
  for (const expected of [
    project.id, project.title, project.description, project.metadata.repository,
    project.metadata.productionUrl, request.id, `버전: ${request.version}`,
    `https://brandyaction-os.vercel.app/knowledge/development?request=${request.id}`,
  ]) assert.ok(prompt.includes(expected), `missing context: ${expected}`);
});

test("request handoff preserves problem, steps, expected result and prior resolution", () => {
  const prompt = buildDevelopmentHandoff(project, request);
  for (const expected of [
    request.title, request.description, request.priority, request.metadata.pageUrl,
    request.metadata.steps, request.metadata.expectedResult, request.metadata.attachmentUrl,
    request.metadata.resolution,
  ]) assert.ok(prompt.includes(expected), `missing request detail: ${expected}`);
  assert.ok(prompt.indexOf(request.description) < prompt.indexOf(request.metadata.expectedResult));
});

test("project-only handoff links the project and does not invent a request", () => {
  const prompt = buildDevelopmentHandoff(project);
  assert.ok(prompt.includes(`?project=${project.id}`));
  assert.equal(prompt.includes("?request="), false);
  assert.equal(prompt.includes("이번 수정요청"), false);
  assert.equal(prompt.includes("undefined"), false);
});

test("handoff uses only the three supplied recent records and bounds each summary", () => {
  const history = Array.from({ length: 5 }, (_, index) => ({
    id: `history-${index}`,
    title: `최근기록_${index}`,
    description: `${String(index).repeat(500)}숨김상세_${index}`,
    status: "tested",
    metadata: { commitSha: `abcde0${index}` },
  }));
  const before = JSON.stringify(history);
  const prompt = buildDevelopmentHandoff(project, request, history);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(prompt.includes(history[index].title));
    assert.ok(prompt.includes(history[index].metadata.commitSha));
    assert.ok(prompt.includes(String(index).repeat(500)));
    assert.equal(prompt.includes(`숨김상세_${index}`), false);
  }
  for (let index = 3; index < history.length; index += 1) {
    assert.equal(prompt.includes(history[index].title), false);
    assert.equal(prompt.includes(history[index].metadata.commitSha), false);
  }
  assert.ok(prompt.indexOf(history[0].title) < prompt.indexOf(history[1].title));
  assert.equal(JSON.stringify(history), before);
});

test("missing or non-text metadata never becomes fabricated handoff context", () => {
  for (const record of [null, undefined, {}, { metadata: {} }, { metadata: { repository: false } }, { metadata: { repository: { secret: "not-context" } } }]) {
    assert.equal(recordText(record, "repository"), "");
  }
  assert.equal(recordText(project, "repository"), project.metadata.repository);
  const prompt = buildDevelopmentHandoff({ ...project, description: "", metadata: {} }, { ...request, metadata: {} });
  assert.ok(prompt.includes("저장소 미지정"));
  assert.ok(prompt.includes("미기재"));
  assert.equal(prompt.includes("undefined"), false);
  assert.equal(prompt.includes("[object Object]"), false);
});

test("safe web links allow canonical HTTP(S) destinations with path and query", () => {
  for (const value of [
    "https://github.com/example-company/internal-os/pull/23",
    "https://os.example.com/knowledge?status=review#results",
    "http://localhost:3000/knowledge/development",
    "https://OS.EXAMPLE.COM",
  ]) assert.equal(safeWebUrl(value), new URL(value).href);
});

test("safe web links reject executable schemes, missing hosts and embedded credentials", () => {
  for (const value of [
    null, undefined, "", "not a URL", "/knowledge", "//example.com/path",
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd", "mailto:person@example.com", "ftp://example.com/source",
    "https://user:password@example.com", "https://user@example.com",
    "https://:password@example.com", "https://user%40company:pass%20word@example.com",
  ]) assert.equal(safeWebUrl(value), null, String(value));
});

test("repository links normalize documented GitHub shorthand and HTTPS formats", () => {
  const expected = "https://github.com/example-company/internal-os";
  for (const value of [
    "example-company/internal-os",
    "example-company/internal-os.git",
    "https://github.com/example-company/internal-os",
    "https://github.com/example-company/internal-os/",
    "https://github.com/example-company/internal-os.git",
    "https://github.com/example-company/internal-os.git/",
  ]) assert.equal(repositoryUrl(value), expected, value);
});

test("repository links reject external hosts, credentials, extra path segments and traversal", () => {
  for (const value of [
    "", "example-company", "example-company/internal-os/issues",
    "https://gitlab.com/example-company/internal-os", "https://github.com.evil.test/example-company/internal-os",
    "https://user:password@github.com/example-company/internal-os",
    "javascript:alert(1)", "data:text/plain,example-company/internal-os",
    "https://github.com/example-company/internal-os?token=private",
    "git@github.com:example-company/internal-os.git",
    "../internal-os", "./internal-os", "example-company/..", "example-company/.",
  ]) assert.equal(repositoryUrl(value), null, value);
});
