# BrandyAction OS Web UI v0.1

## 역할

웹 UI는 Git + Markdown 정본을 사람이 빠르게 읽기 위한 화면이다. 별도의 상태를 만들지 않는다.

```text
Repository Markdown
→ Vercel Build
→ scripts/build-web-data.mjs
→ web/data/os-index.json
→ Read-only Dashboard
```

## 표시 화면

- 전체 업무 공정: Longform 단계와 최근 Run
- 내가 할 일: 선택한 작업자가 현재 담당자인 Run
- 콘텐츠 Run: 상태, 현재 단계, 담당자, 다음 행동
- 결재함: `waiting_approval` 또는 `review` 상태
- Skill Library: Skill 목적, 적용 단계, 허용 도구

## 정본 규칙

- 웹 화면은 Repository를 수정하지 않는다.
- 브라우저의 작업자 선택값은 해당 브라우저에만 저장한다.
- 배포 시점의 Git commit과 JSON 인덱스는 항상 같은 버전이다.
- 고객 개인정보, 비밀번호, API Key는 Repository와 웹 인덱스에 넣지 않는다.

## 로컬 확인

```bash
npm run build
python3 -m http.server 8080 --directory web
```

브라우저에서 `http://localhost:8080`을 연다.
