import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = ts.transpileModule(await readFile(new URL("../lib/server/edu-short-links.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function load(env, reply) {
  const calls = [], compiled = { exports: {} };
  const fetch = async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); const [status, json] = reply(calls.at(-1)); return { ok: status < 300, status, json: async () => json }; };
  runInNewContext(source, { module: compiled, exports: compiled.exports, process: { env }, fetch, AbortSignal, URL,
    require: name => ({ zod, "@/lib/http": { ApiError } })[name] ?? assert.fail(name) });
  return { ...compiled.exports, calls };
}
const env = { EDU_API_BASE: "https://edu.example/", EDU_OS_LINKS_SECRET: "s".repeat(64) };
const link = { key: "free-class", url: "https://edu.example/go/free-class", target: "https://open.kakao.com/o/x", label: "카톡방", channel: "마케팅", active: true, clicks: 3, lastClickedAt: null, createdAt: "", updatedAt: "" };

test("makes, lists and changes EDU links over the Bearer route with the schema's inputs", async () => {
  const edu = load(env, call => [call.init.method === "POST" ? 201 : 200, { data: call.init.method === "GET" ? { items: [link] } : { ...link, created: true } }]);
  const input = edu.eduLinkCreateSchema.parse({ url: " https://open.kakao.com/o/x ", label: "카톡방", channel: "마케팅", key: "" });
  assert.equal((await edu.makeEduLink(input, "u-1")).created, true);
  assert.deepEqual((await edu.listEduLinks()).map(row => row.key), ["free-class"]);
  await edu.changeEduLink(edu.eduLinkPatchSchema.parse({ key: "Free-Class", url: "https://open.kakao.com/o/y" }));
  const [post, get, patch] = edu.calls;
  assert.equal(post.url, "https://edu.example/api/integrations/brandy-os/links");
  assert.equal(post.init.headers.authorization, `Bearer ${env.EDU_OS_LINKS_SECRET}`);
  assert.deepEqual(post.body, { target: "https://open.kakao.com/o/x", label: "카톡방", channel: "마케팅", by: "os:u-1" });
  assert.equal(get.init.method, "GET");
  assert.deepEqual(patch.body, { key: "free-class", target: "https://open.kakao.com/o/y" });
});

test("refuses non-https destinations and malformed keys before calling EDU", () => {
  const edu = load(env, () => assert.fail("no call"));
  assert.throws(() => edu.eduLinkCreateSchema.parse({ url: "http://x.example", label: "a", channel: "b" }), /https:\/\//);
  assert.throws(() => edu.eduLinkPatchSchema.parse({ key: "-bad", active: false }), /주소 끝부분/);
  assert.deepEqual(edu.eduLinkCreateSchema.parse({ url: "https://x.example/a?utm_source=yt" }), { url: "https://x.example/a?utm_source=yt", label: "", channel: "" });
  assert.throws(() => edu.eduLinkCreateSchema.parse({ url: "https://x.example", label: "a".repeat(81) }));
});

test("says plainly what went wrong: no settings, EDU's own refusal, a wrong key, an unreachable EDU", async () => {
  await assert.rejects(load({}, () => assert.fail("no call")).listEduLinks(), error => error.status === 503 && error.code === "EDU_NOT_CONFIGURED");
  await assert.rejects(load(env, () => [409, { message: "이미 쓰는 주소예요." }]).listEduLinks(), error => error.status === 409 && error.message === "이미 쓰는 주소예요.");
  await assert.rejects(load(env, () => [401, { message: "x" }]).listEduLinks(), error => error.status === 502 && /연결 키/.test(error.message));
  await assert.rejects(load(env, () => [500, null]).listEduLinks(), error => error.status === 502 && error.code === "EDU_500");
  const down = load(env, () => { throw new Error("down"); });
  await assert.rejects(down.listEduLinks(), error => error.code === "EDU_UNREACHABLE");
});

test("UTM 단축 on a 브랜디에듀 link makes an EDU short link; the other brands keep the MYIN one", async () => {
  const [utm, brands] = await Promise.all([readFile(new URL("../lib/server/utm-links.ts", import.meta.url), "utf8"), readFile(new URL("../lib/utm.ts", import.meta.url), "utf8")]);
  assert.match(brands, /label: "브랜디에듀", brand: "브랜디액션 에듀"/);
  assert.match(utm, /link\.brand === "브랜디액션 에듀"\s*\?\s*await makeEduLink\(\{ url: link\.utm_url,/);
  assert.match(utm, /:\s*await makeMyinShortLink\(\{ url: link\.utm_url, label \}/);
});
