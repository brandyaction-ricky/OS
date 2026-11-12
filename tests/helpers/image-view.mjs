// Load the real editor/preview TSX independently of the packaged Mac renderer.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function load(url) {
  const require = createRequire(url);
  const fileName = fileURLToPath(url);
  const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {fileName, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }});
  const compiled = { exports: {} };
  const resolve = name => name.endsWith(".tsx") ? load(new URL(name, url)) : require(name);
  new Function("require", "module", "exports", outputText)(resolve, compiled, compiled.exports);
  return compiled.exports;
}

export const { ImageCreativeView } = load(new URL("../../lib/image-creative/view.tsx", import.meta.url));
