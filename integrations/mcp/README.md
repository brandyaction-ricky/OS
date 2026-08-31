# Brandy OS MCP

Claude Code와 Codex가 같은 Brandy OS 지식 API를 사용하는 표준입출력 MCP 서버입니다.

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

읽기 전용으로 한 번 더 잠그려면 `OS_MCP_READ_ONLY=true`를 설정합니다. 서버에서도 PAT 범위, 문서 소유권, 조직 UUID, 쓰기 속도 제한을 별도로 검사합니다.

## Claude Code

환경변수를 안전하게 등록한 셸에서 다음처럼 stdio 서버를 추가합니다.

```sh
claude mcp add os-knowledge -- python3 /absolute/path/to/os_knowledge_mcp.py
```

Codex에서도 같은 Python 명령과 세 환경변수를 stdio MCP 서버 설정에 등록하면 동일한 5개 도구가 노출됩니다.
