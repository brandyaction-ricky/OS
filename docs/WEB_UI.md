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
- Raw Hub: 개인·회사 Raw와 직접 Wiki 승격
- Wiki: Company Wiki와 실무 Wiki 최신본, Raw 근거와 버전
- Skill Library: 카테고리·하위 폴더 탐색, Skill 목적, 적용 단계, 허용 도구, 절차, Output Contract, 품질 기준과 다운로드

## 정본 규칙

- 웹 화면의 일반 조회는 Repository를 수정하지 않는다.
- 콘텐츠 쓰기는 검증된 `/api/push`, Raw 승격은 `/api/promote` 경로만 사용하며 Git Commit으로 남긴다.
- 브라우저의 작업자 선택값은 해당 브라우저에만 저장한다.
- 배포 시점의 Git commit과 JSON 인덱스는 항상 같은 버전이다.
- 고객 개인정보, 비밀번호, API Key는 Repository와 웹 인덱스에 넣지 않는다.

## 작업 버튼

- `작업 시작`: 회사/브랜드 Context, Process, 현재 Skill, 입력 Markdown을 `WORK_PACKAGE.md`로 내려받는다.
- `작업 제출`: 결과 요약·외부 자산 링크·선택 Markdown을 검증해 새 artifact 버전과 `CONTENT.md`를 하나의 Commit으로 반영한다.
- `승인 요청`: 작업 결과를 기록하고 Content Run을 `waiting_approval`로 전환한다.
- `Wiki로 승격`: 작성자의 Raw 원본을 보존하고 승인 없이 Wiki 새 버전을 즉시 만든다.

Raw→Wiki에는 별도 검토·승인 절차가 없다. 이전 Wiki는 삭제하지 않고 `is_latest: false`로 바뀌며 새 `WIKI_vN.md`가 최신본이 된다. 콘텐츠 제작 공정의 승인 요청은 그대로 유지한다.

## Skill 파일 저장 위치

- 정본: GitHub의 `04_skills/{category_id}/{folder_id}/{skill_id}/`
- 분류 정본: `04_skills/CATEGORIES.json`
- 화면 제공: Vercel Build가 최신 Skill을 읽어 Library UI와 다운로드 파일 생성
- 대용량 자산: Drive, NAS, Object Storage 링크만 기록
- 별도 서버: 동시 편집·세밀한 접근권한·검색량이 Git/Vercel 한계를 넘을 때 검토

MP4, WAV, PNG 같은 대용량 원본은 업로드하지 않는다. NAS, Google Drive, Frame.io 등의 링크와 checksum 또는 asset ID만 기록한다.

## Vercel 환경변수

- `GITHUB_TOKEN`: `brandyaction-ricky/OS` Contents 읽기/쓰기 권한의 fine-grained token
- `OS_PUSH_SECRET`: 팀원이 제출할 때 사용하는 충분히 긴 작업 코드
- `GITHUB_REPOSITORY`: 선택, 기본값 `brandyaction-ricky/OS`
- `GITHUB_BRANCH`: 선택, 기본값 `main`

토큰과 작업 코드는 브라우저 코드 또는 Repository에 저장하지 않는다.

현재 작업자 선택 드롭다운은 실제 로그인 인증이 아니다. API는 선택한 작업자와 Raw owner의 일치를 확인하지만, 사용자 신원을 암호학적으로 보장하지 않는다. Pilot 이후 개인 계정 인증을 연결해야 진짜 owner 권한이 된다.

## 로컬 확인

```bash
npm run build
python3 -m http.server 8080 --directory web
```

브라우저에서 `http://localhost:8080`을 연다.
