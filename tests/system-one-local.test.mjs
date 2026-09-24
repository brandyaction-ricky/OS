import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { canUseSystemOneMock } from "../lib/system-one-local.ts";

const local = {
  NODE_ENV: "development",
  OS_ENVIRONMENT: "local",
  NEXT_PUBLIC_DEMO_MODE: "true",
};

test("System One mock accepts only explicitly isolated local development", () => {
  assert.equal(canUseSystemOneMock(local), true);
  assert.equal(canUseSystemOneMock({}), false);
  for (const NODE_ENV of [undefined, "test", "production", "", " development "]) {
    assert.equal(canUseSystemOneMock({ ...local, NODE_ENV }), false);
  }
  for (const OS_ENVIRONMENT of [undefined, "development", "qa", "production", "", "LOCAL"]) {
    assert.equal(canUseSystemOneMock({ ...local, OS_ENVIRONMENT }), false);
  }
  for (const NEXT_PUBLIC_DEMO_MODE of [undefined, "false", "1", "TRUE", ""]) {
    assert.equal(canUseSystemOneMock({ ...local, NEXT_PUBLIC_DEMO_MODE }), false);
  }
});

test("deployment markers close the mock even when local demo flags are present", () => {
  for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID"]) {
    assert.equal(canUseSystemOneMock({ ...local, [key]: "configured" }), false, key);
  }
});

test("partial Supabase configuration and legacy aliases close the mock", () => {
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_FUTURE_ALIAS",
    "DATABASE_URL", "DIRECT_URL",
  ]) {
    assert.equal(canUseSystemOneMock({ ...local, [key]: "test-placeholder" }), false, key);
  }
});

test("each known AI, auth and integration credential closes the mock independently", () => {
  for (const key of [
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY",
    "OS_INITIAL_PASSWORD", "OS_AGENT_TOKEN", "OS_PUBLIC_URL", "CRON_SECRET",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
    "YOUTUBE_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "META_ADS_ACCESS_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "E2E_TEST_EMAIL", "E2E_TEST_PASSWORD",
  ]) {
    assert.equal(canUseSystemOneMock({ ...local, [key]: "test-placeholder" }), false, key);
  }
});

test("empty template values and model names do not count as active connections", () => {
  assert.equal(canUseSystemOneMock({
    ...local,
    SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " ",
    OPENAI_API_KEY: "", ANTHROPIC_API_KEY: undefined, VERCEL_ENV: "",
    OPENAI_ANSWER_MODEL: "test-model", OPENAI_EMBEDDING_MODEL: "test-embedding-model",
  }), true);
});

test("mock gate is pure and never mutates its input environment", () => {
  const environment = Object.freeze({ ...local });
  assert.equal(canUseSystemOneMock(environment), true);
  assert.deepEqual(environment, local);
});

test("standalone mock page has a dynamic server gate and no OS session imports", async () => {
  const source = await readFile(new URL("../app/system-one/page.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = parsed.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier.text)
    .sort();
  assert.deepEqual(imports, [
    "@/components/system-one-sandbox", "@/lib/system-one-local", "next/navigation",
  ]);
  assert.doesNotMatch(source, /["']use client["']/);
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /if \(!canUseSystemOneMock\(process\.env\)\) notFound\(\)/);
  assert.match(source, /return <SystemOneSandbox \/>/);
  assert.doesNotMatch(source, /<SystemOneSandbox\s+\w+=/);
  await assert.rejects(access(new URL("../app/(os)/system-one/page.tsx", import.meta.url)), { code: "ENOENT" });
});

test("local mock does not add an entry to production navigation", async () => {
  const navigation = await readFile(new URL("../lib/navigation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(navigation, /\/system-one/);
});

test("server page denies production before producing any sandbox element", async () => {
  const source = await readFile(new URL("../app/system-one/page.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    fileName: "page.tsx",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  for (const environment of [local, { ...local, NODE_ENV: "production" }, { ...local, OPENAI_API_KEY: "test-placeholder" }]) {
    const pageModule = { exports: {} };
    const rendered = [];
    const blocked = new Error("not found");
    const Sandbox = () => null;
    const modules = {
      "react/jsx-runtime": { jsx: (type, props) => { rendered.push({ type, props }); return null; } },
      "next/navigation": { notFound: () => { throw blocked; } },
      "@/lib/system-one-local": { canUseSystemOneMock },
      "@/components/system-one-sandbox": { SystemOneSandbox: Sandbox },
    };
    runInNewContext(code, {
      module: pageModule, exports: pageModule.exports, process: { env: environment },
      require: (specifier) => {
        assert.ok(Object.hasOwn(modules, specifier), `Unexpected page dependency: ${specifier}`);
        return modules[specifier];
      },
    });
    if (canUseSystemOneMock(environment)) {
      assert.equal(pageModule.exports.default(), null);
      assert.equal(rendered.length, 1);
      assert.equal(rendered[0].type, Sandbox);
      assert.deepEqual(Object.keys(rendered[0].props), []);
    } else {
      assert.throws(() => pageModule.exports.default(), (error) => error === blocked);
      assert.equal(rendered.length, 0);
    }
  }
});
