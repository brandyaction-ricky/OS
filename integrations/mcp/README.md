# Brandy OS MCP

Claude Code와 Codex가 같은 Brandy OS 지식 API를 사용하는 표준입출력 MCP 서버입니다.

운영 서버는 동일한 도구를 Streamable HTTP 방식으로도 제공합니다.

- 원격 MCP URL: `https://brandyaction-os.vercel.app/api/mcp?organizationId=<ORG_UUID>`
- 인증: `Authorization: Bearer <AGENT_PAT>`
- PAT를 URL, 저장소, 플러그인 파일에 직접 넣지 않습니다.

## 연결값

OS 관리자 화면의 `설정 → 권한 → AI 접근 키`에서 다음 값을 발급합니다.

- `KNOWLEDGE_API_URL`: `https://brandyaction-os.vercel.app/api/v1`
- `ORG_UUID`: 화면에 표시되는 조직 UUID
- `AGENT_PAT`: 읽기 또는 읽기·쓰기 범위로 한 번만 발급되는 비밀 토큰

토큰은 소스 코드나 셸 이력에 넣지 말고 사용하는 AI 클라이언트의 비밀 환경변수 저장소에 등록합니다.

## 제공 도구

- `search_knowledge`: 회사 정본 및 해당 키 소유자의 초안 검색
- `get_document`: 문서 원문과 현재 버전 읽기
- `create_document`: 항상 개인 초안으로 생성
- `edit_document`: 버전 보존 수정, 선택적 낙관적 잠금
- `delete_document`: `confirm=true`일 때만 휴지통 이동
- `list_records` / `get_record`: 업무·목표·회의·콘텐츠·성과·경영지원 운영 기록 조회
- `create_record` / `edit_record`: 버전 충돌 방지와 감사 로그를 적용한 운영 기록 생성·수정
- `delete_record`: `confirm=true`일 때만 운영 기록을 휴지통으로 이동

권한 정책 변경, 외부 예약·발행, 영구 삭제는 MCP에서 차단되며 OS 관리 화면에서 사람이 직접 승인해야 합니다.

읽기 전용으로 한 번 더 잠그려면 `OS_MCP_READ_ONLY=true`를 설정합니다. 서버에서도 PAT 범위, 문서 소유권, 조직 UUID, 쓰기 속도 제한을 별도로 검사합니다.

## Claude Code

환경변수를 안전하게 등록한 셸에서 다음처럼 stdio 서버를 추가합니다.

```sh
claude mcp add os-knowledge -- python3 /absolute/path/to/os_knowledge_mcp.py
```

Codex 웹·원격 MCP에는 위 10개 도구가 노출됩니다. 기존 Python stdio 실행기는 지식 5개 도구의 하위 호환 연결로 유지됩니다.

## Codex 원격 MCP

Codex 앱·CLI·IDE에서는 Streamable HTTP 서버로 등록할 수 있습니다. PAT는 클라이언트의 비밀 환경변수 `BRANDY_OS_PAT`에 저장하고 MCP 설정은 해당 변수만 참조합니다. 쓰기 도구는 Codex 승인 정책에서 별도로 확인하도록 `writes` 모드를 권장합니다.

ChatGPT Work 웹은 로컬 Codex 설정을 읽지 않으므로, 원격 MCP가 포함된 Brandy OS 플러그인을 설치해야 합니다.
