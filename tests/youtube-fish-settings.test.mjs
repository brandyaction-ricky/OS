import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

class ApiError extends Error { constructor(status, code, message) { super(message); this.code = code; } }
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/server/fish-audio.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: compiled, exports: compiled.exports, Buffer, AbortSignal,
  require(name) { if (name === 'zod') return { z }; if (name === '@/lib/http') return { ApiError }; throw Error(name); },
});
const { synthesizeFishSegment } = compiled.exports;
const fishVoiceSettings = (env) => JSON.parse(JSON.stringify(compiled.exports.fishVoiceSettings(env)));

test('Fish delivery settings are optional, bounded, and sent as prosody and sampling', async () => {
  assert.deepEqual(fishVoiceSettings({}), {});
  assert.deepEqual(fishVoiceSettings({ FISH_TTS_SPEED: '1.12', FISH_TTS_TEMPERATURE: ' ' }), { speed: 1.12 });
  assert.throws(() => fishVoiceSettings({ FISH_TTS_SPEED: '3' }), { code: 'FISH_SETTINGS_INVALID' });
  let sent;
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...Array(64).fill(0)]);
  const fetcher = async (_url, init) => { sent = { headers: init.headers, body: JSON.parse(init.body) };
    return { ok: true, headers: new Map([['content-type', 'audio/mpeg']]), arrayBuffer: async () => mp3 }; };
  await synthesizeFishSegment('안녕하세요.', { apiKey: 'k', referenceId: 'r', model: 'drama-3-preview', settings: { speed: 1.12, topP: 0.6 }, fetcher }).catch(() => {});
  assert.equal(sent.headers.model, 'drama-3-preview');
  assert.equal(JSON.stringify(sent.body.prosody), '{"speed":1.12}');
  assert.equal(sent.body.top_p, 0.6);
  assert.equal('temperature' in sent.body, false);
});
