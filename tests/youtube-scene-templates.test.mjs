import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import * as svg from '../lib/youtube-scene-svg.ts';

const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/youtube-scene-templates.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: compiled, exports: compiled.exports, Math, Number, Error,
  require(name) { return { zod: { z }, './youtube-scene-svg': svg }[name] ?? (() => { throw Error(name); })(); },
});
const { renderSceneTemplate, youtubeSceneTemplates } = compiled.exports;
const sizes = new Map([['ch13', { width: 1536, height: 1024 }]]);

export const templateSamples = {
  question: { question: '하고 싶은 게 많은데 왜 시작을 못 할까?', accent: '시작' },
  statement: { lines: ['줄여서 될 문제가', '아닙니다'], accent: '아닙니다' },
  character_labels: { character: 'ch13', labels: ['하고 싶은 것 10개', '시작한 것 0개'], accent: '0개' },
  compare: { a: '줄이기', aNote: '흔한 처방', b: '순서 정하기', bNote: '진짜 답', pick: 'b' },
  formula: { a: '남의 기준', b: '내 욕심', result: '순서 없음' },
  list: { items: ['한 길만 파라', '욕심을 버려라', '결국 줄여라'], pick: 2 },
  bar_chart: { bars: [{ label: '떠올린 것', value: 10 }, { label: '계획한 것', value: 5 }, { label: '시작한 것', value: 1 }], unit: '개', highlight: 2, source: '예시 수치' },
  capture: { heading: '선택지가 많을수록 결정은 어렵다', lines: ['선택지가 6개일 때보다 24개일 때', '고르는 비율이 낮았다'], source: '예시 캡처' },
  big_number: { value: '10명 중 7명', caption: '하고 싶은 게 너무 많다', source: '예시 수치' },
  quote: { lines: ['선택지가 너무 많으면', '아무것도 고르지 않는다'], accent: '아무것도', attribution: '예시 인용, 연도' },
  line_chart: { points: [{ label: '1월', value: 8 }, { value: 3 }, { value: 5 }, { value: 2 }, { value: 6 }, { label: '6월', value: 9 }], highlightFrom: 3, callout: '다시 증가', source: '예시 수치' },
  donut: { slices: [{ label: '남을 보고 생김', value: 70 }, { label: '내 안에서 생김', value: 30 }], highlight: 0, center: '70%', source: '예시 수치' },
};

test('every template draws SVG that passes the shared scene boundary', () => {
  assert.equal(youtubeSceneTemplates.length, Object.keys(templateSamples).length);
  for (const name of youtubeSceneTemplates) {
    const drawn = renderSceneTemplate(name, templateSamples[name], sizes);
    const checked = svg.validateSceneSvg(drawn, new Set(sizes.keys()));
    assert.equal(checked.ok, true, `${name}: ${checked.error}`);
    assert.ok(checked.summary.drawSeconds <= 2.5, `${name} finishes within 2.5 s`);
  }
});

test('slots that do not fit their template are rejected, and text is escaped', () => {
  assert.throws(() => renderSceneTemplate('statement', { lines: [] }, sizes));
  assert.throws(() => renderSceneTemplate('character_labels', { character: 'ch99', labels: ['x'] }, sizes));
  assert.throws(() => renderSceneTemplate('freeform', {}, sizes));
  assert.match(renderSceneTemplate('statement', { lines: ['A<B & C'] }, sizes), /A&lt;B &amp; C/);
});
