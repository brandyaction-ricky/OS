---
skill_id: publish-copy
category_id: content-production
category_label: 콘텐츠 제작
folder_id: publishing
folder_label: 게시 · 배포
version: "1.0"
process: longform
step: publish
status: active
inputs: [final_script, final_master_context, cta]
outputs: [publish_md]
allowed_tools: [claude_code, codex]
completion_checks: [output_exists, frontmatter_valid, human_approval_required]
---

# Publish Copy

## PURPOSE

최종 콘텐츠 맥락으로 게시 자산을 작성한다.

## READ CONTEXT

`CONTEXT.md`, 최종 승인 원고, 편집본, 썸네일, CTA, Company/Brand Context를 읽는다.

## PROCEDURE

1. 최종 승인된 핵심 약속과 CTA를 확인한다.
2. 제목, 설명, 타임라인, 고정 댓글을 작성한다.
3. 해시태그, 커뮤니티 글, 출처, UTM 제안을 작성한다.
4. 영상과 게시문구의 사실 및 표현 일치를 점검한다.

## OUTPUT CONTRACT

`publish_vN.md`에 YouTube title, description, timeline, pinned comment, hashtags, community post, source section, UTM suggestion과 실제 게시 URL을 기록한다.

## QUALITY CRITERIA

- 최종 승인된 영상 내용과 일치한다.
- CTA와 UTM을 추적할 수 있다.
- 출처와 링크가 누락되지 않았다.
- 사람이 승인한 후에만 게시 완료 상태로 바뀐다.

## DO NOT

사람 승인 전 실제 게시하지 않는다.

## HANDOFF

`status: waiting_approval`, `approval_status: pending`으로 업로드 승인에 넘긴다.
