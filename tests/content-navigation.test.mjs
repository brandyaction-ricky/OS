import assert from 'node:assert/strict';
import test from 'node:test';
import { findPage, findStage } from '../lib/navigation.ts';

test('production workflow belongs to content rather than the home fallback', () => {
  assert.equal(findStage('/content/automation').id, 'content');
  assert.equal(findPage('/content/automation').label, '제작 공정·파생');
  for (const path of ['/content/topics', '/content/scripts', '/content/packages', '/content/shorts']) {
    assert.equal(findStage(path).id, 'content');
    assert.equal(findPage(path).href, path);
  }
  assert.equal(findStage('/home').id, 'home');
  assert.equal(findPage('/home').label, '오늘 현황');
});
