import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("every account action including password and logout uses the shared row layout", async () => {
  const source = await readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const actions = [];
  const visit = node => {
    if (ts.isJsxElement(node)) {
      const className = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.text === "className");
      if (className?.initializer && ts.isStringLiteral(className.initializer) && className.initializer.text.split(" ").includes("profile-menu-action")) actions.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(actions.length, 5);
  for (const label of ["내 계정 · 채널 연결", "모드로 전환", "메뉴 안내 다시 보기", "비밀번호 변경", "로그아웃"]) assert.ok(actions.some(action => action.includes(label)), label);
  for (const action of actions) assert.match(action, /<span>/, "Every row keeps icon and text in separate aligned columns");
});
