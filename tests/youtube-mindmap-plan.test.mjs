import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

class ApiError extends Error { constructor(status, code, message) { super(message); this.code = code; } }
const load = (file, require) => {
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, require });
  return compiled.exports;
};
const template = load('../lib/youtube-visual-template.ts', (name) => { throw Error(name); });
const { scenePlanSchema } = load('../lib/server/youtube-scenes.ts', (name) => ({ zod: { z }, '@/lib/http': { ApiError }, '@/lib/youtube-visual-template': template,
  './content-model': {}, './fish-audio': {} })[name] ?? (() => { throw Error(name); })());

// Three paragraphs from Logan's n6 video, decks and items as he wrote them.
const plan = (scenes, sections = ['도입', '걱정과 고침']) => ({ sections, unresolved: [], scenes: scenes.map((scene, segmentIndex) => ({ segmentIndex, ...scene })) });
const n6 = [
  { deck: '09', items: ['걱정|헷갈린 안내', '직접 고친 것|문장 수정', '도움받은 것|확인 자료', '맡을 일|조건까지 보기'], section: 0 },
  { deck: '35', items: ['무엇이 마음에 걸렸을까요?'], section: 1 },
  { deck: '41', items: ['안내 제작|0.4', '문의 응대|0.8'], section: 1 },
];

test('a plan in Logan\'s deck formats is accepted', () => {
  assert.equal(scenePlanSchema.safeParse(plan(n6)).success, true);
});

test('item counts and formats his deck code cannot draw are rejected', () => {
  const broken = (index, change) => scenePlanSchema.safeParse(plan(n6.map((scene, i) => i === index ? { ...scene, ...change } : scene))).success;
  assert.equal(broken(0, { items: ['걱정|헷갈린 안내'] }), false, '2x2 needs four cells');
  assert.equal(broken(0, { items: ['걱정', '고침', '도움', '맡길 일'] }), false, '2x2 cells are "title|text"');
  assert.equal(broken(2, { items: ['안내 제작|40%', '문의 응대|0.8'] }), false, 'bar ratios are 0..1');
  assert.equal(broken(1, { deck: '17', items: ['걱정|도움', '고침'] }), false, '| only in 09, 10 and 41');
  assert.equal(broken(1, { deck: '24', items: ['인용문'] }), false, 'quote decks wrap on spaces');
  assert.equal(broken(1, { deck: '17', items: ['1', '2', '3', '4', '5'] }), false, 'horizontal steps hold four');
});

test('sections follow the script: start at 0, step by one, end on the last name, one typing question', () => {
  assert.equal(scenePlanSchema.safeParse(plan(n6.map((scene) => ({ ...scene, section: 1 })))).success, false);
  assert.equal(scenePlanSchema.safeParse(plan(n6, ['도입', '걱정과 고침', '마무리'])).success, false);
  assert.equal(scenePlanSchema.safeParse(plan([n6[0], { ...n6[1], section: 0 }, { ...n6[1], section: 1 }])).success, false);
});
