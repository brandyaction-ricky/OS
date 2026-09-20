import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const navigation = readFileSync(new URL("../lib/navigation.ts", import.meta.url), "utf8");

test("content calendar resolves to the content stage and its own breadcrumb", () => {
  assert.match(navigation, /label: "발행 캘린더", href: "\/content\/calendar"/);

  const contentStage = navigation.slice(
    navigation.indexOf('id: "content"'),
    navigation.indexOf('id: "knowledge"'),
  );
  assert.match(contentStage, /href: "\/content\/calendar"/);
});
