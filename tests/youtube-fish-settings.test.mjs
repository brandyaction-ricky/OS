import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

class ApiError extends Error { constructor(status, code, message) { super(message); this.code = code; } }
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/server/fish-audio.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: compiled, exports: compiled.exports, Buffer, AbortSignal, TextDecoder,
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

test('Fish word timings are clamped into their chunk instead of failing the paragraph', async () => {
  const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString('base64');
  const event = { audio_base64: mp3, content: '', chunk_seq: 0, chunk_audio_offset_sec: 0, alignment: { audio_duration: 2, segments: [
    { text: '안녕', start: 0, end: 0.8 }, { text: ',', start: 0.8, end: 0.8 }, { text: '', start: 0.8, end: 0.9 },
    { text: '하세요', start: 0.75, end: 2.3 },
  ] } };
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); controller.close(); } });
  const { words } = await compiled.exports.parseFishTimestampedStream(body);
  assert.deepEqual(JSON.parse(JSON.stringify(words.map((word) => word.text))), ['안녕', ',', '하세요']);
  for (const [index, word] of words.entries()) {
    assert.ok(word.endSeconds > word.startSeconds && word.endSeconds <= 2.01);
    if (index) assert.ok(word.startSeconds >= words[index - 1].endSeconds);
  }
});
