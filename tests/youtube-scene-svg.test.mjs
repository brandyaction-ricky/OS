import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSceneSvg } from '../lib/youtube-scene-svg.ts';

const ids = new Set(['ch18']);
const good = '<g transform="translate(640 430) scale(1.1) translate(-640 -430)"><rect class="i p" x="545" y="232" width="190" height="64" rx="18" data-k="draw" data-s="0" data-d=".35"/><text class="lab acc" x="640" y="266" data-k="fade" data-s=".25" data-d=".25">같은 일 &amp; 반응</text></g><image data-character="ch18" x="110" y="250" width="510" height="340" data-k="character" data-s="0" data-d="1.1"/><rect x="291" y="375" width="14" height="102" fill="#E12B31" data-k="grow-y" data-s="1.85" data-d=".6"/>';

test('scene SVG accepts the drawing vocabulary and reports characters and drawing time', () => {
  const result = validateSceneSvg(good, ids);
  assert.equal(result.ok, true);
  assert.deepEqual([...result.summary.characters], ['ch18']);
  assert.equal(result.summary.drawSeconds, 2.45);
});

test('scene SVG accepts lines, whose attribute names contain digits', () => {
  assert.equal(validateSceneSvg('<line class="i" x1="300" y1="400" x2="900" y2="400" data-k="draw" data-s="0" data-d=".5"/>', ids).ok, true);
});

test('scene SVG rejects active content, external resources and unregistered art', () => {
  for (const bad of [
    '<script>alert(1)</script>',
    '<foreignObject width="10" height="10"></foreignObject>',
    '<rect x="1" y="1" width="2" height="2" onload="x"/>',
    '<rect x="1" y="1" width="2" height="2" style="fill:red"/>',
    '<image href="https://example.com/a.png" x="0" y="0" width="1" height="1"/>',
    '<image data-character="ch99" x="0" y="0" width="1" height="1" data-k="character" data-s="0" data-d="1"/>',
    '<rect x="1" y="1" width="2" height="2" fill="#00ff00"/>',
    '<rect x="1" y="1" width="2" height="2" data-k="draw"/>',
    '<g><rect x="1" y="1" width="2" height="2"/>',
    '<text x="1" y="1">a &nbsp; b</text>',
    'loose text',
    '<rect x="1" y="1" width="2" height="2" class="i evil"/>',
    '<!-- comment --><rect x="1" y="1" width="2" height="2"/>',
  ]) assert.equal(validateSceneSvg(bad, ids).ok, false, bad);
});
