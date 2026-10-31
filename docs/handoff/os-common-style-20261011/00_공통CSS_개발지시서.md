# 브랜디 OS 공통 CSS 구조 — 개발 지시서 v1.0

- 작성: 2026-10-11 · 대상 저장소 `brandyaction-ricky/OS` · 기준 main `3e2a1aa`
- 목표: 기획한 화면 CSS가 개발에 **그대로** 나오게, CSS 우선순위를 레이어로 고정하고 공통 토큰·부품·검사를 넣는다.
- 함께 보는 파일
  - `01_공통스타일가이드.md` — 규칙 (이 지시서보다 우선)
  - `02_현황진단.md` — 왜 바꾸는지, 숫자
  - `css/os-foundation.css` — 새 파일 (토큰 · 공통 부품)
  - `tests/os-css-architecture.test.mjs` — 새 검사
  - `tools/wrap-css-layers.mjs` — CSS 파일을 레이어로 감싸는 도구
  - `tools/css-fingerprint.mjs` — 메뉴 52개 + 편집기 화면의 계산된 스타일을 비교하는 도구
  - `style/styleguide.html` — 견본
- 표기: [확인] 이 저장소에서 직접 돌려 본 것 / [추론] 검증 전 / [결정] 대표 결정이 필요한 곳(01 11장)

---

## 0. 한눈에

| 단계 | 하는 일 | 화면 변화 | 확인한 결과 [확인 2026-10-11, 체험 모드 빌드] |
|---|---|---|---|
| **L0** | 모든 CSS를 `@layer os.legacy` 로 감싸기 + 편집기 CSS 사본 | 없음 | 메뉴 52개 + 편집기 화면: 다른 요소 0 (잡음 10 제외) |
| **L1** | 키트·화면 층으로 나누기 + `os-foundation.css` + `!important` 짝 지우기 | 68곳 — 전부 목록에 있는 것 (3장 완료 기준) | 같은 68곳 [확인] |
| **L2** | 메뉴마다 키트 부품으로 옮기기 (PR 하나에 메뉴 하나) | 메뉴별 의도한 변화 | 검사 숫자(BASELINE)가 줄어야 함 |
| L3 | `globals.css` 안 쓰는 규칙 정리 | 없음 | 나중 |

**하지 않는 것**
- 색 토큰 값 바꾸기 · 새 색 토큰 · 메뉴 화면 기능 바꾸기 · DB · API.
- 운영 배포, main 병합. 각각 따로 승인.

---

## 1. 지켜야 할 규칙

- `AGENTS.md` 를 따른다. 브랜치 `codex/os-css-layers-20261011`, 별도 작업 공간(worktree). main 에 직접 커밋하지 않는다.
- **단계마다 PR 하나.** L0 와 L1 을 섞지 않는다. 화면 변화가 없어야 하는 L0 가 따로 있어야 문제를 찾기 쉽다.
- 단계마다 지문 비교 결과를 `docs/review/os-css-layers/{단계}.txt` 로 남긴다.
- 화면 문구 · 마크업 · 컴포넌트 동작은 L2 전까지 바꾸지 않는다.

### 1.1 체험 모드로 지문 재기 (모든 단계 공통)

```bash
export NEXT_PUBLIC_DEMO_MODE=true HR_WORKSPACE_ENABLED=true TEAM_V1_ENABLED=true
npm run build && npx next start -p 3100 -H 127.0.0.1 &
node tools/css-fingerprint.mjs out/base.json              # 바꾸기 전 (main 그대로)
# … 바꾼 뒤 다시 빌드·실행 …
node tools/css-fingerprint.mjs out/after.json out/base.json
```

- 같은 빌드를 두 번 재도 `/knowledge?tab=canon` 표 칸 10개 정도는 너비가 조금 다르다 [확인] → 잡음.
- 설치된 Playwright 브라우저 판이 다르면 `PW_CHROMIUM=/브라우저/경로` 를 준다.
- 서버를 다시 띄울 때는 앞 서버를 꼭 끈다. [확인] 앞 서버가 남아 있으면 새 빌드의 CSS 파일 이름과 안 맞아 결과가 엉터리가 된다.

---

## 2. L0 — 감싸기만 (화면 변화 0)

1. `tools/wrap-css-layers.mjs` · `tools/css-fingerprint.mjs` · `tests/os-css-architecture.test.mjs` 를 저장소에 넣는다.
2. 바꾸기 전 지문: `node tools/css-fingerprint.mjs out/base.json`
3. `node tools/wrap-css-layers.mjs L0`
   - 모든 CSS 파일 첫 줄: `@layer os.vendor, os.base, os.legacy, os.kit, os.screen;`
   - `app/theme-tokens.css` 는 순서 문장만 넣고 감싸지 않는다 (색 토큰은 레이어 밖).
   - 나머지는 `@layer os.legacy { 원래 내용 }`.
   - `@mdxeditor/editor` CSS 를 `components/vendor/mdxeditor.layered.css` 로 복사해 같은 층으로 감싸고, `components/knowledge-rich-editor-initialized.tsx:32` 의 import 를 그 파일로 바꾼다.
     - 이유 [확인]: 레이어 밖 CSS는 모든 레이어를 이긴다. 그대로 두면 OS가 편집기를 덮어쓰던 규칙이 진다.
     - 이유 [확인]: `@import "…" layer(…)` 는 Next 15.5.2 에서 `@media layer(…)` 로 바뀌어 규칙이 안 먹는다. 그래서 사본을 만든다.
4. `tests/os-css-architecture.test.mjs` 의 `const STAGE = "L1";` 을 `"L0"` 으로.
5. `tests/screenshot-theme-regressions.test.mjs:12-15` 의 `styles()` 를 고친다 — 파일 맨 위 규칙만 읽어서, 감싸면 3개가 실패한다 [확인].
   ```js
   css.walkRules(rule => {
     if (rule.parent?.type === "atrule" && rule.parent.name !== "layer") return; // @media 안 규칙은 전처럼 뺀다
     if (!rule.selector.split(",").some(s => normalize(s) === normalize(selector))) return;
     for (const d of rule.nodes) if (d.type === "decl") result[d.prop] = d.value;
   });
   ```
6. `npm run verify` (lint · typecheck · test · build).
7. 지문 비교: `node tools/css-fingerprint.mjs out/L0.json out/base.json`

**L0 완료 기준**
- 지문 차이: 잡음(정본 탭 표 칸) 말고 0. 편집기 화면 포함.
- `npm test` 전부 통과 [확인: 786 + 새 6 = 792].
- 새 CSS 파일을 만들려면 `tests/os-css-architecture.test.mjs` 의 `FILE_LAYER` 와 `tools/wrap-css-layers.mjs` 표에 같이 적는다.

---

## 3. L1 — 층 나누기 + 공통 기반

1. `node tools/wrap-css-layers.mjs L1 <전달폴더>/css/os-foundation.css`
   - `app/os-foundation.css` 를 넣고 `app/layout.tsx` 에서 `theme-tokens.css` 바로 다음에 import.
   - 파일별 층은 표대로 (01 가이드 3장 · 검사의 `FILE_LAYER`):
     - `os.kit`: `os-ui.css` · `fullscreen-shell.css` · `fullscreen-content.css` · `fullscreen-documents.css` · `fullscreen-operations.css`
     - `os.screen`: `team-workspace.css` · `content-automation-v07.css` · `content-automation-worker.css` · `hr/hr.css` · `finance/finance.css` · `knowledge-vault.css` · `knowledge/workspace.css`
     - 나머지 `os.legacy` (편집기 사본 포함 — D2)
2. 검사 `STAGE` 를 `"L1"` 로.
3. **`!important` 짝 지우기** — 옛 파일과 화면 파일이 서로 이기려고 둘 다 `!important` 를 쓴 곳. 레이어에서는 앞 층의 `!important` 가 이기므로(거꾸로) 화면 쪽 값이 사라진다 [확인]. 둘 다 지운다.

   | 파일 | 선택자 | 지울 것 |
   |---|---|---|
   | `app/globals.css:987` | `.knowledge-rich-content` | `padding` · `color` 의 `!important` |
   | `app/globals.css:992` | `@media(max-width:760px) .knowledge-rich-content` | `padding` 의 `!important` |
   | `app/globals.css:1038` | `.knowledge-new-canvas-body .knowledge-rich-content` | `padding` 의 `!important` |
   | `components/knowledge-vault.css:209` | 편집기 본문 | `padding` · `color` 의 `!important` |
   | `components/knowledge-vault.css:280` | `.screen-vault … .knowledge-rich-content` | `padding` · `color` 의 `!important` |

   - `knowledge-vault.css:29 · 123` (`.vault-mobile-tree display`) 의 `!important` 는 지우지 않는다. [확인] 지우면 1440px 에서도 모바일 트리 단추가 보인다.
4. `npm run verify` · 지문 비교.

**L1 완료 기준** (지문 차이 = 아래 68곳만. 다른 곳이 바뀌면 멈추고 보고) [확인 2026-10-11, 이 도구로 돌린 결과]

| 화면 | 수 | 바뀜 | 뜻 |
|---|---|---|---|
| `/content/shorts` · `/content/performance` · `/settings/access` · 편집기 | 14 | `small` 9.2~10.8px → 11px | `os-foundation.css` 보정 (의도) |
| `/knowledge/vault` | 2 | 작은 단추 28 → 30px | 보관함 CSS 값이 이제 이김 — D5 |
| 보관함 편집기 | 1 | 입력 둥글기 6 → 7 | 보관함 CSS 값이 이제 이김 — L2-5 |
| `/hr/employees` · `leave` · `leave-ledger` · `documents` | 37 | 링크 색 `--accent-2` → 인사 CSS 값(`#5e6ad2` · `--hr-muted`) · 찾기 칸 12 → 13px | 인사 CSS 값이 이제 이김 — L2-3 에서 키트로(D4) |
| `/finance/sales` · `/finance/bank` | 14 | 찾기 칸 12 → 13px · 둥글기 6 → 8 · 높이 | 재무 CSS 값이 이제 이김 — L2-4 에서 키트로(D4) |

- [확인] `!important` 짝을 지우기 전에는 편집기에서 7곳(본문 여백·글자색)이 더 바뀐다.
- 인사·재무는 L1 에서 손대지 않는다. [확인] 토큰 대체값·`font: inherit` 만 고쳐서는 0 이 되지 않는다(인사 CSS가 원래 정한 링크 색·여백이 드러남). 메뉴 정리(L2)에서 화면을 보며 맞춘다.

---

## 4. L2 — 메뉴별 정리 (PR 하나에 메뉴 하나)

공통: 키트 부품(01 가이드 6장)으로 바꾸고, 접두어 밖 클래스 · 색 직접 쓰기 · 요소 선택자를 없앤다. 끝나면 검사의 `BASELINE` 숫자를 줄여 적는다(늘면 실패). 화면 캡처 1440 · 390 × 다크 · 라이트를 `docs/review/os-css-layers/` 에 남긴다.

| 순서 | 메뉴 | 할 일 | 줄어야 할 검사 숫자 [확인 기준값] |
|---|---|---|---|
| 1 | 콘텐츠 자동화 (`content-automation-v07.css` · `.tsx`) | `button` · `h1` · `p` · `a` 요소 선택자 → 키트 클래스. 단추 `.primary-button/.secondary-button`, 배지 `.status-pill[data-tone]`(01 5장), 표 `.data-table`, 분절 `.segmented`, 도구 줄 `.os-toolbar`. 루트를 `main.ca-v07` → `div.ca-root` | color 15 → 0 |
| 2 | 회사 문서 (`knowledge/workspace.css`) | 자기 색 7개 · `[data-theme="dark"] .kw-root` 4규칙 → OS 토큰 (D6). `/knowledge/notes` · `meetings` · `canon` · `trash` 를 `lib/fullscreen-screen.ts` 에 등록해 `ui-v2 screen-*` 붙이기. 단추 → 키트 | color 59 · themeSel 4 · important 12 → 0 |
| 3 | 인사 (`hr/hr.css`) | `--hr-*` → OS 토큰 직접(대체값 `#hex` 지우기, `--hr-accent` → `var(--accent-2)`). 입력의 `font: inherit` → `font-family: inherit`. h1 20 → `.page-title`(22). 단추 31px → 키트. 배지 `.hr-pill` → `.status-pill[data-tone]`. L1 에서 드러난 37곳을 캡처로 보고 키트 쪽으로 맞춤(D4) | color 54 → 0 |
| 4 | 재무 (`finance/finance.css`) | L1 에서 드러난 찾기 칸 14곳을 키트로(D4: `.input` 의 `font-size` · `border-radius` · `min-height` 지우기). 접두어 `fin-`. `#tip` `#toast` → 클래스. 일반 이름 `.pill` `.chip` `.toolbar` `.input` → 키트(`.status-pill[data-tone]` `.os-chip` `.os-toolbar` 기본 입력). 별칭 토큰(`--surface` · `--fg` …) → OS 토큰 직접. 인라인 style 30곳 → 클래스 | idSel 4 · foreign 465 · kitOverride 31 · color 11 → 0 |
| 5 | 문서 보관함 (`knowledge-vault.css`) | 키트 단추 높이 덮기 → 키트 변형(D5). 남은 `!important` | kitOverride 11 |
| 6 | 팀 (`team-workspace.css`) | `.tm-callout/.tm-chip/.tm-toolbar/…` → `os-*` 로 바꾸고 `tm-` 쪽 규칙 지우기. 17px 제목 → 18. `.workspace-tabs` 상자 끄기 → 키트 변형 | kitOverride 4 · fontOff 4 |
| 7 | 개발 (`development-workspace.css`, 옛 층) | 단추 31~33px → 키트. 화면 머리 → `.page-header` | fontOff 6 · important 4 |

- 메뉴 CSS를 화면 층에 옮길 때마다 L1 처럼 지문을 비교하고, 바뀐 곳을 표로 PR 에 적는다.
- 상태 배지 대응(01 5장)에서 [추론] 칸(개발 · 재무)은 화면 문구와 맞춰 보고 다르면 보고한다.

---

## 5. 테스트 변경표

| 파일 | 바꿈 |
|---|---|
| `tests/screenshot-theme-regressions.test.mjs:12-15` | 맨 위 규칙만 읽기 → `walkRules` (L0) |
| `tests/os-css-architecture.test.mjs` | 새로 추가 (6개). L0 에서 `STAGE="L0"`, L1 부터 `"L1"` |
| `tests/team-workspace-style.test.mjs` | 그대로 통과 [확인] — 맨 끝 import 검사도 그대로 |
| `tests/final-style.test.mjs` | 그대로 통과 [확인] |

새 검사가 막는 것 (자세한 것은 파일 주석)
1. 모든 CSS 파일이 `FILE_LAYER` 표에 있고, 첫 줄이 같은 순서 문장
2. 규칙이 정해진 레이어 블록 안에만 있음 (색 토큰 파일만 예외)
3. `@import` 없음
4. 패키지 CSS 를 컴포넌트에서 바로 import 하지 않음
5. `layout.tsx` 에서 색 토큰 → `os-foundation` 순서
6. 파일마다 `!important` · 색 직접 쓰기 · 테마 선택자 · id 선택자 · 크기 단계 밖 · 끊는 점 밖 · 접두어 밖 클래스 · 키트 모양 덮기 수가 기준값보다 늘지 않음
- [확인] 일부러 어긴 파일(표에 없는 새 CSS · `@import … layer()` · 화면 파일에 `#ffffff` · 패키지 CSS 직접 import)을 넣으면 해당 검사가 실패한다.

---

## 6. 미결정 (기본값으로 진행, 바꾸기 쉬운 곳에 둠)

01 가이드 11장 D1~D7. 이 지시서에 영향이 큰 것:
- **D2** 편집기 CSS 층: 기본 `os.legacy`(지금 그대로). `os.vendor` 로 내리면 도구 글자색 19곳이 바뀐다 [확인].
- **D4** 인사·재무 찾기 칸: 기본 키트(12px · 6).
- **D5** 보관함 작은 단추 30px: 기본 허용 [추론: 보관함 시안 값].
- **D6** 회사 문서 색: 기본 OS 토큰으로 (L2-2 에서 화면 전체 색이 바뀜 → 캡처로 대표 확인 후 병합).

---

## 7. Codex 첫 지시문 (그대로 붙여넣기)

```
너는 brandyaction-ricky/OS 저장소에서 'OS 공통 CSS 구조 v1.0'을 개발한다.
먼저 AGENTS.md, docs/handoff/os-common-style-20261011/ 의 README.md, 00_공통CSS_개발지시서.md, 01_공통스타일가이드.md, 02_현황진단.md 를 읽어라.
새 worktree에서 브랜치 codex/os-css-layers-20261011 을 만들고 main 에 직접 커밋하지 마라.
지시서 2장 L0 만 먼저 한다: tools 2개와 tests/os-css-architecture.test.mjs 를 넣고, 체험 모드로 바꾸기 전 지문을 잰 뒤, node tools/wrap-css-layers.mjs L0 를 돌리고, 검사 STAGE 를 "L0" 로, screenshot-theme-regressions 검사를 지시서대로 고친다.
npm run verify 를 통과하고, 지문 차이가 잡음(정본 탭 표 칸) 말고 0 인지 확인해 docs/review/os-css-layers/L0.txt 에 남긴다. 0 이 아니면 멈추고 보고한다.
L0 PR 을 올린 뒤 같은 방식으로 L1(지시서 3장)을 별도 PR 로 한다. L1 지문 차이는 지시서 3장 완료 기준 표와 같아야 한다.
L2 는 메뉴 하나에 PR 하나. 화면 문구·동작은 바꾸지 않는다. 색 토큰 값은 바꾸지 않는다.
DB·API 변경, 병합, 배포는 하지 마라.
완료 보고는 AGENTS.md 형식(한국어)으로: 경로·브랜치, 기준·결과 커밋, 지문 비교 결과, 한 검증·안 한 검증과 이유, 남은 결정(D1~D7).
```
