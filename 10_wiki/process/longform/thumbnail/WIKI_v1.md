---
schema_version: "1.0"
id: wiki-process-longform-thumbnail-v1
entity_type: wiki
wiki_id: longform-thumbnail
wiki_type: process
process: longform
step: thumbnail
category: video-production
owner: jay
title: 유튜브 썸네일 폐쇄 루프 기준
status: active
version: 1
is_latest: true
source_ids: [thumbnail-closed-loop-v1, thumbnailpeak-critique-097a7b]
promoted_by: ricky
promoted_at: 2026-08-24T19:30:00+09:00
created_at: 2026-08-24T19:30:00+09:00
updated_at: 2026-08-24T19:30:00+09:00
updated_by: ricky
---

# 유튜브 썸네일 폐쇄 루프 기준

## 목적

썸네일을 한 번 만들고 끝내지 않는다. 아이디어 가설부터 실제 CTR까지 같은 Content Run에 연결해 다음 썸네일 제작의 입력으로 재사용한다.

```text
아이디어 → AI 생성 → AI 평가 → 사람 승인 → 업로드 → CTR 측정 → 학습
   ↑                                                              ↓
   └──────────────── 다음 Content Run의 아이디어 Context ──────────┘
```

## 단계별 산출물

1. 아이디어: 핵심 약속, 타깃 시청자, 카피 A/B, 시각 가설, 피해야 할 표현
2. AI 생성: 후보별 Asset ID, 프롬프트, seed, 생성 모델과 버전
3. AI 평가: 항목별 점수, 근거, 가장 먼저 고칠 한 가지, 후보 순위
4. 사람 승인: 최종 후보 Asset ID, 선택 이유, 수정 여부
5. 업로드: 적용된 YouTube 영상 ID, 썸네일 checksum, 적용 시각
6. CTR 측정: 노출·CTR의 1h·6h·24h·7d 스냅샷과 썸네일 변경 시각
7. 학습: 예상과 실제 차이, 유지·폐기할 규칙, 다음 실험 가설

## AI 평가 Scorecard

### 시각 품질

- 가독성: YouTube 추천 영역의 작은 크기에서도 핵심 카피가 읽히는가
- 시각적 위계: 첫 시선이 핵심 메시지와 피사체로 이동하는가
- 주제 명확성: 무엇에 관한 영상인지 즉시 이해되는가
- 대비: 색·명암·크기로 피사체와 카피가 분리되는가
- 호기심: 과장 없이 다음 정보를 알고 싶게 만드는가
- 차별성: 같은 주제의 일반적인 썸네일과 구별되는가
- 신뢰·완성도: 합성 오류·과도한 AI 질감·브랜드 훼손이 없는가

### 콘텐츠 적합성

- 주제 일치: 영상의 실제 핵심과 썸네일 약속이 일치하는가
- 약속 일관성: 클릭 후 영상이 썸네일의 기대를 충족하는가
- 제목 보완성: 썸네일이 제목을 반복하지 않고 다른 정보를 더하는가

각 항목은 1~4점으로 평가하고 총점을 100점으로 환산한다. 총점만 저장하지 않고 항목별 근거와 개선 우선순위를 함께 저장한다.

## 사람 승인 원칙

- AI 점수 1위를 자동 채택하지 않는다.
- 영상의 핵심 약속, 브랜드 적합성, 제목과의 역할 분담을 사람이 확인한다.
- 승인 시 선택 후보 ID와 선택 이유를 반드시 기록한다.
- 승인 이후 수정한 경우 새 Asset ID와 checksum으로 다시 기록한다.

## CTR 측정 원칙

- 최소 1h·6h·24h·7d 스냅샷을 분리한다.
- 조회수가 아니라 노출수와 CTR을 함께 본다.
- 썸네일 교체가 있었다면 교체 전후를 같은 구간으로 합치지 않는다.
- 표본이 작거나 유입원이 크게 바뀌면 인과관계를 단정하지 않는다.
- AI 평가 점수와 실제 CTR이 달랐던 이유를 학습 기록에 남긴다.

## 참고 평가 화면

Thumbnail Peak Critique의 평가 화면을 UI 참고로 사용했다.

https://thumbnailpeak.com/critique?id=097a7b2328d282fe933bd45c51d5f267617872e5cc3d2245bf274a336fb0acb0
