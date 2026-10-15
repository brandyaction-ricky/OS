import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationFromMarkdown, APPROVED_SCRIPT_STATUSES } from '../lib/youtube-narration-document.ts';

test('only spoken paragraphs survive from a script document', () => {
  const markdown = ['---', 'tags: [원고]', '---', '### 날짜 : 2026-09-08', '# 원고 v8', '', '| 항목 | 값 |', '|---|---|',
    '"나 이 일 **적성**에 안 맞나 봐."', '그러면 꼭 이런 말이 돌아오죠.', '', '---', '> [[기획_절차|절차]]를 따릅니다.', '- 질문 세 개로 나눠보겠습니다.', '<!-- 메모 -->'].join('\n');
  assert.equal(narrationFromMarkdown(markdown), '"나 이 일 적성에 안 맞나 봐."\n그러면 꼭 이런 말이 돌아오죠.\n\n절차를 따릅니다.\n질문 세 개로 나눠보겠습니다.');
  assert.deepEqual([...APPROVED_SCRIPT_STATUSES], ['reviewed', 'canonical']);
});
