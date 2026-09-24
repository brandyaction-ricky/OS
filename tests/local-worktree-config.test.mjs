import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function configFor(directory, workingDirectory) {
  const configModule = { exports: {} };
  // Next 15 loads TypeScript config as CommonJS at the config directory.
  vm.runInNewContext(compiled, {
    module: configModule,
    exports: configModule.exports,
    __dirname: directory,
    __filename: path.join(directory, "next.config.compiled.js"),
    process: { cwd: () => workingDirectory, env: {} },
  });
  return configModule.exports.default;
}

test("nested worktrees use their own directory for output tracing", () => {
  const repository = path.resolve("fixture-repository");
  const worktree = path.join(repository, ".worktrees", "task");
  const config = configFor(worktree, repository);
  assert.equal(config.outputFileTracingRoot, worktree);
  assert.notEqual(config.outputFileTracingRoot, repository);
});

test("tracing root follows the checkout location without changing existing options", () => {
  for (const directory of [path.resolve("checkout with spaces"), path.resolve("한글 작업 폴더"), "/vercel/path0"]) {
    const config = configFor(directory, "/unrelated-launch-directory");
    assert.equal(config.outputFileTracingRoot, directory);
    assert.equal(config.poweredByHeader, false);
    assert.equal(config.experimental.optimizePackageImports.join(","), "lucide-react");
  }
});
