import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import * as template from '../lib/youtube-visual-template.ts';

class ApiError extends Error { constructor(status, code, message) { super(message); this.code = code; } }
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/server/youtube-timeline.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: compiled, exports: compiled.exports, Buffer, Number, JSON,
  require(name) { return { 'node:crypto': { createHash }, zod: { z }, '@/lib/http': { ApiError }, '@/lib/youtube-visual-template': template }[name] ?? (() => { throw Error(name); })(); },
});
const { createYoutubeTimedTranscriptFromFish, alignYoutubeVisualBeats, createYoutubeRenderBrief, captionShownOnScreen } = compiled.exports;
const sha = (value) => createHash('sha256').update(value).digest('hex');

const script = ['같은 일을 해도 누군가는 사람을 만날 때 에너지가 생깁니다'];
const words = ['같은', '일을', '해도', '누군가는', '사람을', '만날', '때', '에너지가', '생깁니다'].map((text, i) => ({ text, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.45 }));
const audio = Buffer.from('segment-audio');
const timing = { version: 'fish-stream-timing-v1', textHash: sha(JSON.stringify(script[0])), audioSha256: sha(audio), durationSeconds: 4.6, words };
const beat = (spokenAnchor, displayText, typographyAnchor) => ({ spokenAnchor, idea: 'idea text', svg: '<rect x="1" y="1" width="2" height="2"/>', displayText, accentText: '', typographyAnchor });
const plan = { visualDirection: 'x'.repeat(20), visualFirst: true, typographyMode: 'single_active_cue', thumbnailDirection: 'thumbnail', unresolved: [],
  scenes: [{ segmentIndex: 0, visualType: 'diagram', visualPrompt: 'prompt text', evidenceNote: '', visualBeats: [beat('같은 일을 해도', '같은 일', '해도'), beat('사람을 만날 때', '다른 에너지', '에너지가')] }] };

test('verified word times bind visual beats and headlines to the final narration', () => {
  const finalAudio = Buffer.from('final-audio');
  const transcript = createYoutubeTimedTranscriptFromFish({ scriptSegments: script, finalAudio, finalDurationSeconds: 4.6,
    segments: [{ audio, timing, offsetSeconds: 0, measuredDurationSeconds: 4.6 }] });
  const timeline = alignYoutubeVisualBeats(plan, script, transcript, sha(finalAudio));
  assert.equal(JSON.stringify(timeline.beats.map((b) => [b.visualStartSeconds, b.typographyStartSeconds, b.endSeconds])), '[[0,1,2],[2,3.5,4.6]]');
  assert.equal(createYoutubeRenderBrief(plan, timeline).timingSource, 'verified_word');
});

test('changed audio and script drift are rejected; a headline outside its beat is left out', () => {
  const finalAudio = Buffer.from('final-audio');
  assert.throws(() => createYoutubeTimedTranscriptFromFish({ scriptSegments: script, finalAudio, finalDurationSeconds: 4.6,
    segments: [{ audio: Buffer.from('other'), timing, offsetSeconds: 0, measuredDurationSeconds: 4.6 }] }), { code: 'YOUTUBE_AUDIO_CHANGED' });
  const transcript = createYoutubeTimedTranscriptFromFish({ scriptSegments: script, finalAudio, finalDurationSeconds: 4.6, segments: [{ audio, timing, offsetSeconds: 0, measuredDurationSeconds: 4.6 }] });
  assert.throws(() => alignYoutubeVisualBeats(plan, script, transcript, sha(Buffer.from('x'))), { code: 'YOUTUBE_AUDIO_CHANGED' });
  const early = structuredClone(plan); early.scenes[0].visualBeats[0].typographyAnchor = '에너지가';
  const withoutTitle = alignYoutubeVisualBeats(early, script, transcript, sha(finalAudio)).beats[0];
  assert.equal(withoutTitle.displayText, '');
  assert.equal(withoutTitle.typographyStartSeconds, null);
  assert.equal(createYoutubeRenderBrief(early, alignYoutubeVisualBeats(early, script, transcript, sha(finalAudio))).timingSource, 'verified_word');
  assert.throws(() => alignYoutubeVisualBeats(plan, ['다른 원고입니다'], transcript, sha(finalAudio)), { code: 'YOUTUBE_TRANSCRIPT_MISMATCH' });
});

test('a beat too short to read is folded into the previous beat', () => {
  const finalAudio = Buffer.from('final-audio');
  const transcript = createYoutubeTimedTranscriptFromFish({ scriptSegments: script, finalAudio, finalDurationSeconds: 4.6,
    segments: [{ audio, timing, offsetSeconds: 0, measuredDurationSeconds: 4.6 }] });
  const short = structuredClone(plan);
  short.scenes[0].visualBeats.splice(1, 0, beat('누군가는', '', ''));
  short.scenes[0].visualBeats[1].svg = '<image data-character="ch01" x="1" y="1" width="2" height="2"/>';
  const timeline = alignYoutubeVisualBeats(short, script, transcript, sha(finalAudio));
  assert.equal(JSON.stringify(timeline.beats.map((b) => [b.beatIndex, b.visualStartSeconds, b.endSeconds])), '[[0,0,2],[2,2,4.6]]');
  short.unresolved = ['acknowledged note'];
  assert.equal(createYoutubeRenderBrief(short, timeline).timingSource, 'verified_word');
});

test('drawing parts start on their spoken cue, and captions skip words already on screen', () => {
  const finalAudio = Buffer.from('final-audio');
  const transcript = createYoutubeTimedTranscriptFromFish({ scriptSegments: script, finalAudio, finalDurationSeconds: 4.6,
    segments: [{ audio, timing, offsetSeconds: 0, measuredDurationSeconds: 4.6 }] });
  const cued = structuredClone(plan);
  cued.scenes[0].visualBeats[1].cues = ['사람을 만날 때', '에너지가'];
  cued.scenes[0].visualBeats[1].svg = '<text x="1" y="1">에너지가 생깁니다</text>';
  const timeline = alignYoutubeVisualBeats(cued, script, transcript, sha(finalAudio));
  assert.equal(JSON.stringify(timeline.beats[1].cueSeconds), '[0,1.5]');
  assert.ok(timeline.captions.length >= 2);
  assert.equal(timeline.captions[0].startSeconds, 0);
  assert.equal(captionShownOnScreen('에너지가 생깁니다', '에너지가생깁니다다른에너지'), true);
  assert.equal(captionShownOnScreen('같은 일을 해도', '에너지가생깁니다'), false);
});
