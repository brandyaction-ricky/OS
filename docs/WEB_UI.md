# BrandyAction OS Web UI v0.2

## 역할

웹 UI는 Git + Markdown 정본을 사람이 빠르게 읽고, 검증된 작업 결과를 제출하는 화면이다. 별도의 상태 DB를 만들지 않는다.

```text
Repository Markdown
→ Vercel Build
→ scripts/build-web-data.mjs
→ web/data/os-index.json
→ Dashboard + Web Push Gateway
```

## 표시 화면

- 전체 업무 공정: Longform 단계와 최근 Run
- 내가 할 일: 선택한 작업자가 현재 담당자인 Run
- 콘텐츠 Run: 상태, 현재 단계, 담당자, 다음 행동
- 회의 노트: 노션형 편집, 녹음 전사, AI 정리, Markdown 저장·폴더 이동
- 유튜브 제작: PDF 원본 8공정을 독립 단계로 포함한 20개 실행 Stage와 썸네일 7단계 폐쇄 루프를 표시하는 공정별 작업 화면
- 직원 워크스페이스: 담당 업무, 공정 Step, 공유 Wiki와 Access Skill 연결
- Company Wiki: 회사 공통·공정·직원 공유 Wiki 최신본
- OS Access Skills: 카테고리·폴더 탐색, 호출 Wiki, Context 반환 규칙과 다운로드

## 정본 규칙

- 웹 화면의 일반 조회는 Repository를 수정하지 않는다.
- 콘텐츠 쓰기는 검증된 `/api/push` 경로만 사용하며 Git Commit으로 남긴다.
- 회의록 쓰기는 검증된 `/api/meetings` 경로만 사용하며 Git Commit으로 남긴다.
- 브라우저의 작업자 선택값은 해당 브라우저에만 저장한다.
- 배포 시점의 Git commit과 JSON 인덱스는 항상 같은 버전이다.
- 고객 개인정보, 비밀번호, API Key는 Repository와 웹 인덱스에 넣지 않는다.

## 작업 버튼

- `작업 시작`: 회사/브랜드 Context, Process, 현재 Access Skill, Skill이 지정한 최신 Wiki와 입력 Markdown을 `WORK_PACKAGE.md`로 내려받는다.
- `작업 제출`: 결과 요약·외부 자산 링크·선택 Markdown을 검증해 새 artifact 버전과 `CONTENT.md`를 하나의 Commit으로 반영한다.
개인 Raw와 개인 전용 Wiki는 개인 Obsidian에 둔다. 회사 OS에는 공유된 최신 Wiki만 연결하며 이전 버전은 Git 이력으로 보존한다. 별도 결재함은 두지 않고, 사람 확인이 필요한 값은 해당 제작 Stage 안에서 바로 확정한다.

## 유튜브 제작 실행 경계

- 개인 PC: 작업 패키지 수신, 개인 AI, 자막·덱·이미지, Premiere 메인 편집, 최종 MP4·SRT 검수
- 브라우저: 최종 MP4·SRT·썸네일을 Object Storage에 직접 업로드
- OS API: 공정 상태, Markdown 결과, Asset ID, Worker Queue와 callback 관리
- 실행 Worker: FFprobe 완료본 검사, FFmpeg 숏폼 렌더, YouTube 업로드·성과 회수
- 썸네일 Worker: Image API 후보 생성, Vision Scorecard 평가, 후보 Manifest 저장
- 인증: 공정마다 OS 작업 코드 입력란을 표시하지 않고, 상단에서 한 번 연결한 HttpOnly 8시간 팀 세션을 사용

## Access Skill 파일 저장 위치

- 정본: GitHub의 `04_skills/{category_id}/{folder_id}/{skill_id}/`
- 분류 정본: `04_skills/CATEGORIES.json`
- 화면 제공: Vercel Build가 최신 Access Skill을 읽어 호출 Wiki와 공정 연결을 표시
- 대용량 자산: Drive, NAS, Object Storage 링크만 기록
- 별도 서버: 동시 편집·세밀한 접근권한·검색량이 Git/Vercel 한계를 넘을 때 검토

MP4, WAV, PNG 같은 대용량 원본은 업로드하지 않는다. NAS, Google Drive, Frame.io 등의 링크와 checksum 또는 asset ID만 기록한다.

## Vercel 환경변수

- `GITHUB_TOKEN`: `brandyaction-ricky/OS` Contents 읽기/쓰기 권한의 fine-grained token
- `OS_PUSH_SECRET`: 팀 작업 세션을 발급할 때 한 번만 확인하는 충분히 긴 작업 코드
- `GITHUB_REPOSITORY`: 선택, 기본값 `brandyaction-ricky/OS`
- `GITHUB_BRANCH`: 선택, 기본값 `main`
- `OPENAI_API_KEY`: 회의 녹음 전사와 AI 회의록 정리에 사용
- `OPENAI_TRANSCRIBE_MODEL`: 선택, 기본값 `gpt-transcribe`
- `OPENAI_MEETING_MODEL`: 선택, 기본값 `gpt-5.6`
- `MEETING_REPOSITORY`: 회의 Markdown을 저장할 비공개 GitHub Repository. 미설정 시 저장 차단
- `MEETING_GITHUB_TOKEN`: 위 비공개 회의 저장소 하나에만 Contents 읽기/쓰기 권한을 가진 전용 token
- `MEETING_GITHUB_BRANCH`: 선택, 비공개 회의 저장소 branch. 기본값 `GITHUB_BRANCH` 또는 `main`
- `OPENAI_AUTOMATION_MODEL`: 선택, 기본값 `gpt-5.6`
- `OPENAI_WEB_SEARCH_ENABLED`: 선택, `true`일 때 자막 용어와 업로드 출처 확인에 Web Search 사용
- `ASSET_UPLOAD_SESSION_URL`: Object Storage의 제한된 직접 업로드 세션 발급 주소
- `ASSET_UPLOAD_SERVICE_SECRET`: 위 업로드 세션 서비스 호출 전용 인증값
- `VIDEO_WORKER_WEBHOOK_URL`: FFprobe·FFmpeg 완료본 검증·숏폼 Worker 주소
- `THUMBNAIL_WORKER_WEBHOOK_URL`: 썸네일 Image 생성·Vision 평가 Worker 주소
- `YOUTUBE_WORKER_WEBHOOK_URL`: YouTube Data API 업로드 Worker 주소
- `METRICS_WORKER_WEBHOOK_URL`: YouTube 성과 수집 Worker 주소
- `VIDEO_WORKER_SECRET` / `VIDEO_CALLBACK_SECRET`: 렌더 Worker 호출·callback 전용 인증값
- `THUMBNAIL_WORKER_SECRET` / `THUMBNAIL_CALLBACK_SECRET`: 썸네일 Worker 호출·callback 전용 인증값
- `YOUTUBE_WORKER_SECRET` / `YOUTUBE_CALLBACK_SECRET`: YouTube 게시 Worker 전용 인증값
- `METRICS_WORKER_SECRET` / `METRICS_CALLBACK_SECRET`: 성과 수집 Worker 전용 인증값
- `YOUTUBE_PUBLISH_APPROVAL_SECRET`: 공용 OS 작업 코드와 분리된 게시 권한자 전용 승인 코드
- `YOUTUBE_PUBLISH_APPROVER`: 선택, 서버가 기록할 게시 승인자 ID. 기본값 `ricky`
- `AUTOMATION_CALLBACK_URL`: 선택, Worker callback 고정 주소. 비우면 Vercel 운영 주소를 사용
- `ALLOW_PUBLIC_ASSET_URLS`: 기본 `false`. 공개해도 되는 HTTPS 자산만 예외적으로 저장할 때 명시적으로 `true`

토큰과 작업 코드는 브라우저 코드 또는 Repository에 저장하지 않는다. 현재 OS Repository가 공개인 동안에는 회의 Markdown, 고객 정보, 서명 URL을 저장하지 않는다.

현재 작업자 선택 드롭다운은 실제 로그인 인증이 아니다. 그래서 YouTube 게시만 별도 승인 코드와 서버 고정 승인자를 추가로 요구한다. Pilot 이후 개인 계정 인증을 연결해야 나머지 직원 Workspace 권한도 강제할 수 있다.

## 회의록 저장 흐름

```text
직접 메모 또는 브라우저 녹음
→ 약 2분 단위 전사
→ AI 회의록 초안
→ 사람이 직접 수정
→ 06_meetings/inbox
→ organized 또는 decisions로 이동
```

`06_meetings/index.json`에는 목록용 메타데이터만 두고, 본문은 사용자가 작업 코드를 입력해 문서를 열 때 비공개 Repository에서 한 건씩 읽는다. 공개 `os-index.json`에는 회의 경로·메타데이터·본문을 넣지 않는다.

오디오 원본은 GitHub에 저장하지 않는다. OpenAI 공식 파일 전사 API가 지원하는 녹음 파일을 사용하며, OS 화면에서는 Vercel 요청 크기를 고려해 2.5MB 이하 구간만 전송한다.

## 로컬 확인

```bash
npm run build
python3 -m http.server 8080 --directory web
```

브라우저에서 `http://localhost:8080`을 연다.
