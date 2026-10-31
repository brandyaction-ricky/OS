# 측정 도구 사용법 (2026-10-31)

아래 명령은 **이 전달물 폴더(`docs/handoff/os-style-fix-20261031/`)에서** 실행한다. 도구는 저장소의 `node_modules`(Playwright·postcss)를 그대로 쓴다.

## 다시 재기

1. 저장소 루트에서 체험 모드로 빌드하고 실행한다.
   ```
   NEXT_PUBLIC_DEMO_MODE=true HR_WORKSPACE_ENABLED=true TEAM_V1_ENABLED=true YOUTUBE_V1_ENABLED=true npm run build
   NEXT_PUBLIC_DEMO_MODE=true HR_WORKSPACE_ENABLED=true TEAM_V1_ENABLED=true YOUTUBE_V1_ENABLED=true npx next start -p 3100 -H 127.0.0.1
   ```
2. `tools/tokens.txt`는 `app/theme-tokens.css`의 토큰 이름 목록이다. 토큰이 바뀌면 저장소 루트에서 다시 만든다.
   ```
   grep -oE "^\s*--[a-z0-9-]+" app/theme-tokens.css | tr -d ' ' | sort -u | tr '\n' ' ' > docs/handoff/os-style-fix-20261031/tools/tokens.txt
   ```
3. 잰다.
   - 전체 화면(사이드바를 따라 모음, 약 45분):
     ```
     mkdir -p tools/shots && node tools/os-style-audit.cjs http://127.0.0.1:3100 results/after.json
     ```
   - 고른 화면만(화면당 약 30초, 캡처는 `SHOTS` 폴더에 저장):
     ```
     mkdir -p shots && ROUTES="/automation/topics /hr/employees" SHOTS=$PWD/shots node tools/os-style-audit-subset.cjs http://127.0.0.1:3100 results/after_sub.json
     ```
4. 메뉴별 표를 만든다.
   ```
   python3 tools/analyze.py results/after.json results/after_rows.json
   ```

- 브라우저가 없다는 오류(`Executable doesn't exist`)가 나면 `npx playwright install chromium`을 실행하거나, 이미 있는 Chromium 경로를 `PW_CHROMIUM=/경로/chrome`으로 넘긴다. 모든 도구가 이 값을 읽는다.

## 도구

| 파일 | 하는 일 |
|---|---|
| `tools/os-style-audit.cjs` | 사이드바 주소를 모아 화면마다 1440px 밝게·어둡게, 390px 어둡게로 잰다. 제목·단추·입력·판 둥글기·11px 미만 글자·글자 대비·인라인 style·가로 넘침·누를 곳 크기 |
| `tools/os-style-audit-subset.cjs` | 위와 같은 측정을 `ROUTES`에 적은 화면만 |
| `tools/analyze.py` | 결과를 메뉴별로 묶어 기준(키트) 밖 수를 센다 |
| `tools/trace.cjs` | 한 요소의 값을 정한 CSS 규칙(선택자)을 찾는다(브라우저 개발 도구 프로토콜). 예: `node tools/trace.cjs '[{"route":"/hr/employees","sel":"main .hr-pill","props":["color"]}]'` |
| `tools/leak.cjs` | 화면을 옮겨 다닌 뒤 같은 화면의 값이 새로 연 것과 같은지 비교 |
| `tools/layout.cjs` | 화면마다 제목 위치·크기, 본문 상자 위치 |

## 기준

- 글자 대비 4.5:1 이상. 18px 이상이거나 굵은 14px 이상이면 3:1 이상.
- 글자 11px 이상, 누를 곳 24px 이상.
- 키트 값: 제목 22 · 단추 28/12/6 · 입력 32 · 판 10. P2 결정 뒤 이 값을 고친다.

## 한계

- 체험 데이터만 본다. 운영 실데이터 상태·직원 권한 화면·실제 휴대폰은 확인하지 않는다.
- `/organization/members`는 체험 모드에서 서버 오류(인사 서버 설정 필요)로 측정되지 않는다.
- 바탕이 그라데이션·그림인 글자는 대비 계산에서 뺀다.
