# 브랜디 OS v2

회사의 실행·콘텐츠·지식·성과 데이터를 한곳에서 운영하는 내부 OS입니다. 이번 재구축의 첫 번째 작동 범위는 **지식 문서 관리와 검색 API**입니다.

## 기술 구조

- UI/서버: Next.js App Router, Vercel(v0 프로젝트와 연결)
- DB/Auth: Supabase `brandyaction OS` (`evnbriltxiqgglnftlrw`)
- 검색: PostgreSQL 전문 검색 + pgvector 하이브리드 검색
- 외부 통로: Telegram webhook, 직원 AI용 MCP 어댑터

## 로컬 실행

```bash
cp .env.example .env.local
npm install
npm run dev
```

Supabase 키가 없으면 UI 구조를 확인할 수 있는 데모 모드로 열립니다. 실제 저장·검색은 환경변수 연결 후 활성화됩니다.

## 주요 경로

- `/home`: 회사 관제탑
- `/knowledge`: 지식 문서 작업공간
- `/knowledge/search`: 지식 검색
- `POST /api/v1/search`: 사람과 에이전트 공용 검색 API
- `GET|POST|PATCH|DELETE /api/v1/documents`: 문서 API
- `POST /api/v1/documents/:id/status`: 검토 상태 전환
- `GET /api/v1/health`: 서버·DB 준비 상태

운영 설정과 API 계약은 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md), [`docs/openapi.yaml`](docs/openapi.yaml)을 참고합니다.
