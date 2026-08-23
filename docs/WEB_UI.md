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
- 결재함: `waiting_approval` 또는 `review` 상태
- Skill Library: Skill 목적, 적용 단계, 허용 도구

## 정본 규칙

- 웹 화면의 일반 조회는 Repository를 수정하지 않는다.
- 쓰기는 검증된 `/api/push` 경로만 사용하며 Git Commit으로 남긴다.
- 브라우저의 작업자 선택값은 해당 브라우저에만 저장한다.
- 배포 시점의 Git commit과 JSON 인덱스는 항상 같은 버전이다.
- 고객 개인정보, 비밀번호, API Key는 Repository와 웹 인덱스에 넣지 않는다.

## 작업 버튼

- `작업 시작`: 회사/브랜드 Context, Process, 현재 Skill, 입력 Markdown을 `WORK_PACKAGE.md`로 내려받는다.
- `작업 제출`: 결과 요약·외부 자산 링크·선택 Markdown을 검증해 새 artifact 버전과 `CONTENT.md`를 하나의 Commit으로 반영한다.
- `승인 요청`: 작업 결과를 기록하고 Content Run을 `waiting_approval`로 전환한다.

MP4, WAV, PNG 같은 대용량 원본은 업로드하지 않는다. NAS, Google Drive, Frame.io 등의 링크와 checksum 또는 asset ID만 기록한다.

## Vercel 환경변수

- `GITHUB_TOKEN`: `brandyaction-ricky/OS` Contents 읽기/쓰기 권한의 fine-grained token
- `OS_PUSH_SECRET`: 팀원이 제출할 때 사용하는 충분히 긴 작업 코드
- `GITHUB_REPOSITORY`: 선택, 기본값 `brandyaction-ricky/OS`
- `GITHUB_BRANCH`: 선택, 기본값 `main`

토큰과 작업 코드는 브라우저 코드 또는 Repository에 저장하지 않는다.

## 로컬 확인

```bash
npm run build
python3 -m http.server 8080 --directory web
```

브라우저에서 `http://localhost:8080`을 연다.
