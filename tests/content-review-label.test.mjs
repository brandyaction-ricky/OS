import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as pipeline from '../lib/content-pipeline.ts';
import * as contentInput from '../lib/content-input.ts';

test('review history includes approvals and revision requests without calling both approvals', () => {
  const state = { source: { id: 'qa', metadata: {}, version: 1 }, records: [], reviews: [
    { gate: 1, approved: true, at: '2026-01-01T00:00:00Z', note: 'Synthetic approval' },
    { gate: 2, approved: false, at: '2026-01-02T00:00:00Z', note: 'Synthetic revision request' },
  ], approved: [true, false, false], missing: [[], [], []], signatures: ['a', 'b', 'c'] };
  const values = [state, false, '', {}]; let cursor = 0;
  const imports = { react: { ...React, useState: () => [values[cursor++], () => {}], useEffect: () => {}, useCallback: fn => fn },
    'react/jsx-runtime': jsx, 'next/link': { default: 'a' }, '@/lib/api-client': {}, '@/lib/content-pipeline': pipeline, '@/lib/content-input': contentInput,
    './session-provider': { useSession: () => ({ accessToken: null }) } };
  const compiled = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../components/content-pipeline-panel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: compiled, exports: compiled.exports, require(name) { if (name in imports) return imports[name]; throw Error(name); } });
  const html = renderToStaticMarkup(React.createElement(compiled.exports.ContentPipelinePanel, { sourceId: 'qa', onChange: async () => {} }));
  assert.match(html, /검토 이력 2건/);
  assert.doesNotMatch(html, /승인 이력 2건/);
  assert.match(html, /검토 이력에는 승인과 수정 요청이 모두 포함됩니다/);
  assert.match(html, /Synthetic approval/);
  assert.match(html, /Synthetic revision request/);
});
