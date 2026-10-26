# 숏폼 세로 도식 연결

로건 세로 도식 70종을 선택·편집·저장·제작할 수 있다. 기존 가로 엔진을 수정하지 않고 별도 로건 v15.2 세로 패키지의 `portrait/render_job.py`를 호출한다. 모든 도식 장면은 direct · 9:16 전용이며 기존 이미지 장면과 섞을 수 있다. OS 목록은 `lib/shortform-diagram-catalog.json`이 정의하며 설치 패키지의 지원 유형과 일치해야 한다.

## 실행 조건

- OS 서버: `YOUTUBE_SHORTFORM_DIAGRAMS_ENABLED=true`일 때만 새 도식 제작 요청을 받는다. 기본값은 꺼짐.
- OS 빌드: `NEXT_PUBLIC_SHORTFORM_DIAGRAMS_ENABLED=true`일 때 편집 화면에 선택기를 표시한다. 로컬 데모에서는 선택·편집만 가능하다. 위 두 설정은 같은 환경에서 함께 켠다.
- 렌더 PC: `SHORTFORM_DIAGRAM_PACKAGE`에 검토한 패키지의 절대 경로를 지정한다. 운영 가로 패키지와 별도 폴더로 설치한다.
- Python 3.9+ / Pillow, Node / Playwright / Chromium, ffmpeg / ffprobe 필요. `MYIN_FONT_DIR`은 허가된 Pretendard 폰트 폴더다. 필요할 때 `PLAYWRIGHT_MODULE`, `CHROME_PATH`, `MINDMAP_PYTHON`으로 로컬 실행 경로를 지정한다.
- `shortform-diagrams.mjs`, `shortform-renderer.mjs`, `shortform-caption.py`, `youtube-media-worker.mjs`는 같은 버전으로 설치한다. 폰트·비밀값은 코드 패키지에 포함하지 않는다.

워커는 로컬 패키지와 의존성을 확인한 뒤 공통 목록과 설치 등록부가 모두 지원하는 유형만 claim에 광고한다. 이전 워커는 도식 작업을 가져가지 않으며 기존 이미지/롱폼 클립 작업은 계속 처리한다. 서버 규격은 임의 SVG·URL·실행 코드 입력을 받지 않는다.

## 장면 입력과 자막

장면의 기존 이미지 대신 `diagram: { type, scene }`을 저장한다. 등장 시각은 각 장면 시작부터 센다. 세부 입력은 `shortformDiagramSchema`가 제한하며 장면 길이 밖 시각을 거절한다. 도식은 1000×1250 좌표에서 그린 뒤 720×1280 화면의 x36/y90, 648×810 영역에 놓는다. 자막은 기존 자막 합성기를 사용하되 최대 두 줄만 허용한다. 초과하면 자동 축소하지 않고 오류로 돌려보낸다. 음성은 기존 비용 동의/서명/소유자 확인 경로를 그대로 따른다.

## 적용 순서와 되돌리기

1. 검토 패키지를 별도 개발 폴더에 풀고 원본 해시/로컬 무음 렌더를 확인한다.
2. 개발 OS와 개발 워커에 위 코드·설정을 적용하고 새 작업이 지원 워커에만 배정되는지 확인한다.
3. 운영 반영은 별도 승인 후 진행한다. Claude가 진행 중인 작업 및 가로 운영 폴더를 변경하지 않는다. 렌더가 비어 있을 때 지정된 운영 워커만 교체한다.
4. 되돌릴 때 새 요청을 막고 진행 중인 도식 작업을 먼저 마친다. 진행 중 작업이 남은 상태에서 서버 기능을 끄면 현재 입력 검증에서 작업이 중단될 수 있다. 그 후 별도 패키지 경로/선택기 설정을 해제한다.

## 검증 범위

70종 기본 입력 630프레임과 가변 항목 경계 48사례 288프레임, 데모 화면의 70종 편집과 390px 폭을 검수했다. 개발 Preview에서 실제 70종 선택·저장, 연속 수정 후 새로고침 보존을 확인했고, 격리 Macmini 워커로 대표 3종의 15초 무음 영상 제작·업로드·다운로드를 검증했다. 운영 설치·배포와 유료 음성 시험은 미실행이다. 임의의 긴 문구 조합은 실제 원고별 검수가 필요하다.

개별 연결 시험은 `SHORTFORM_RENDER_ID`에 이번 무음 작업 ID를 지정하고 `--shorts-only --once`로 실행한다. 해당 작업만 가져가므로 기존 개발 대기열과 유료 음성 작업을 건드리지 않는다. 개발 화면에서 새 유튜브 공정을 사용하려면 `YOUTUBE_V1_ENABLED=true`도 필요하다.

## Full catalog and serialized saving (2026-10-26)

All 70 Logan portrait types are selectable. The checked-in catalog defines per-type defaults and a bounded field tree (text, number, enum, boolean, array). The API rejects unknown nested fields and invalid selection indices; narration cues, markup, paths and arbitrary renderer options are not accepted. Scene-local clocks are rescaled when choosing a template. Each worker advertises only catalog types also present in its installed portrait registry. Deploy the worker with the repository `tools/` and `lib/shortform-diagram-catalog.json` relative layout intact.

The editor saves the latest draft again if edits arrive while a previous save is pending, using the returned version. Idle edits save after 600 ms, render submission waits for the save drain, and unsaved changes warn before browser unload. Save failures retain the draft and show an explicit retry button. Automated tests exercise delayed saves and failure recovery.
