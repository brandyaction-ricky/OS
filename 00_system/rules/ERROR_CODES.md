# BA CLI Error Codes v0.1

| Code | Meaning | Recovery |
|---|---|---|
| `E_REPO_NOT_FOUND` | OS 저장소를 찾지 못함 | 저장소 안에서 실행하거나 `BA_REPO_ROOT` 지정 |
| `E_CONTENT_NOT_FOUND` | Content Run 없음 | Content ID 확인 또는 `ba new content` 실행 |
| `E_WORKSPACE_NOT_FOUND` | Pull된 Workspace 없음 | `ba pull CONTENT_ID` 실행 |
| `E_WORKSPACE_EXISTS` | 미완료 Workspace가 이미 있음 | 기존 Output 확인, 필요할 때만 `--force` |
| `E_WORKSPACE_STALE` | Pull 이후 관련 저장소 파일 변경 | Output 보존 후 새 Pull에 재반영 |
| `E_REMOTE_NEWER` | Pull 이후 upstream 변경 | 저장소 최신화 후 새 Pull |
| `E_REPOSITORY_BEHIND` | 로컬 저장소가 upstream보다 뒤이거나 분기 | fast-forward 최신화, 자동 merge 금지 |
| `E_VALIDATION` | Schema 또는 무결성 실패 | `ba validate`로 상세 확인 |
| `E_OUTPUT_MISSING` | 필수 Output 누락 | Process Output Contract 확인 |
| `E_VERSION_CONFLICT` | 다음 버전 번호 불일치 | 새 Pull로 올바른 vN 초안 생성 |
| `E_GIT_COMMIT` | 파일 반영 후 commit 실패 | Git 상태 확인 후 같은 Push 재실행 |
| `E_GIT_PUSH` | 로컬 commit 후 upstream push 실패 | 네트워크/권한 확인 후 같은 Push 재실행 |

충돌과 Schema 오류는 자동 수정하지 않는다. CLI는 원본 Output을 `.workspace`에 남기고 실패한다.

