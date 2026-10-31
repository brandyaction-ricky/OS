# P1 패치 전후 측정 (2026-10-31)

- 전: main `f5bffd6` 체험 모드 빌드, 화면 82개 측정(`m1031_before.json`).
- 후: 같은 커밋 + `p1.patch`, 영향 화면과 대조 화면 23개 측정(`after_p1.json`).
- 모드: 1440px 밝게·어둡게, 390px 어둡게. 기준: 글자 대비 4.5:1(큰 글자 3:1), 11px, 누를 곳 24px.

## 결과 [확인]

| 화면 | 대비 미달 밝게 | 대비 미달 어둡게 | 11px 미만 (1440) | 11px 미만 (390) | 24px 미만 누를 곳 (390) | 가로 넘침 px (390) |
|---|---|---|---|---|---|---|
| `/automation/topics` | 0 | 3 → 0 | 0 | 0 | 0 | 0 |
| `/automation/references` | 0 | 1 → 0 | 0 | 0 | 0 | 0 |
| `/hr/employees` | 21 → 0 | 21 → 0 | 0 | 0 | 0 | 0 |
| `/hr/leave` | 5 → 0 | 5 → 0 | 0 | 0 | 0 | 0 |
| `/hr/leave-ledger` | 4 → 0 | 4 → 0 | 0 | 0 | 0 | 0 |
| `/hr/documents` | 30 → 0 | 30 → 0 | 0 | 0 | 0 | 0 |
| `/hr/my-leave` | 1 → 0 | 1 → 0 | 0 | 0 | 0 | 0 |
| `/knowledge/notes` | 0 | 3 → 0 | 0 | 0 | 0 | 0 |
| `/knowledge/canon` | 0 | 2 → 0 | 0 | 0 | 0 | 0 |
| `/knowledge?tab=canon` | 0 | 2 → 0 | 0 | 0 | 0 | 0 |
| `/content/links` | 0 | 0 | 0 | 0 | 0 | 0 |
| `/content/card-canon` | 0 | 0 | 7 → 0 | 7 → 0 | 0 | 0 |
| `/content/performance` | 0 | 0 | 6 → 0 | 6 → 0 | 0 | 0 |
| `/settings/access` | 0 | 0 | 9 → 0 | 9 → 0 | 1 → 0 | 0 |
| `/settings/connections` | 0 | 0 | 3 → 0 | 3 → 0 | 9 → 0 | 0 |
| `/finance/sales` | 0 | 0 | 0 | 0 | 25 → 0 | 0 |
| `/finance/settlements` | 0 | 0 | 0 | 0 | 38 → 0 | 0 |
| `/finance/bank` | 0 | 0 | 0 | 0 | 56 → 0 | 0 |
| `/finance/cards` | 0 | 0 | 0 | 0 | 15 → 2 | 0 |
| `/organization/meetings` | 0 | 0 | 3 → 0 | 3 → 0 | 1 → 0 | 0 |
| `/organization/schedule` | 0 | 0 | 3 → 0 | 3 → 0 | 1 → 0 | 0 |
| `/home` | 0 | 0 | 0 | 0 | 0 | 0 |
| `/content/plan` | 0 | 0 | 0 | 0 | 0 | 0 |
| **합계** | 61 → 0 | 72 → 0 | 31 → 0 | 31 → 0 | 146 → 2 | 0 → 0 |

- 남은 것 1가지: `/finance/cards` 휴대폰 표의 거래처 칸(`.rowbtn.ell`) 2곳이 높이 24px·폭 22px이다. 칸이 좁아 글자가 줄임표로 잘린 경우다. 높이는 기준을 넘는다. 폭은 P2에서 표 칸 최소 폭으로 다룬다.
- 직접 확인한 값:
  - `/content/links`: 탭 줄·제목·첫 카드의 x가 모두 360px로 같다(전: 탭 264px).
  - 안내 줄 닫기 단추 24×24px, 번호 11px(전: 18×18px, 10.5px).
- 화면 구조 변화: 23개 화면의 요소 수가 패치 전과 같다(탭 줄을 감싼 `<div>` 1개가 늘어난 `/content/links`만 +1).

## 시험

- `node --test tests/os-style-p1.test.mjs`: 패치 전 0/6, 패치 후 6/6.
- `npm test`: 1,298개 중 1,293 통과, 4 건너뜀, 1 실패. 실패 1개는 `tests/shortform-diagrams.test.mjs` "portrait animation…"(`SHORTFORM_RENDER_FAILED`)이다. 패치 전 `f5bffd6`에서도 같이 실패하는 렌더러 환경 문제다.

## 캡처

`evidence/before_*.png` ↔ `evidence/after_*.png`. 패치 후 캡처 원본은 같은 체험 빌드에서 찍었다.
