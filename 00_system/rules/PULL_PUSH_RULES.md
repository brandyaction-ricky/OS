# Pull / Push Rules v1.0

## 기본 흐름

OS Repository → Pull → Local Workspace → Work → Validate → Push → OS 최신화 → Next Step

## Pull

```bash
ba pull BA-0268
```

가져오는 것:

- `CONTENT.md`의 현재 상태를 복사한 `CONTEXT.md`
- 현재 Step이 참조하는 최신 Input
- 연결 Skill 전체와 루트 `SKILL.md`
- Company/Brand Context
- 다음 버전 번호가 반영된 Output 초안

로컬 작업공간:

```text
.workspace/BA-0268/
├─ CONTEXT.md
├─ SKILL.md              # Skill이 연결된 Step만
├─ workspace.json        # Pull 기준 스냅샷
├─ skill/
├─ input/
└─ output/
```

## Push

```bash
ba push BA-0268 --step script
```

Push 검사:

1. Pull 당시 파일 해시와 현재 저장소 비교
2. Git upstream 최신 상태 확인
3. Frontmatter Schema 검사
4. 필수 Output 검사
5. `content_id`, `step`, 파일명 검사
6. Version 증가 검사
7. `updated_by`, `updated_at` 기록
8. 최신 파일 포인터와 `is_latest` 갱신
9. Completion Condition 평가
10. 다음 Step Ready 처리
11. Git commit 및 upstream push

## 충돌

저장소 또는 Git 원격이 Pull 기준보다 최신이면 Push를 막는다. 자동 merge와 자동 덮어쓰기는 금지한다.

## Version 불변성 예외

이전 버전의 본문과 판단 기록은 수정하지 않는다. 새 버전 생성 시 이전 파일에 허용되는 유일한 변경은 `is_latest: true → false`다. 최종 최신본 판단은 `CONTENT.md` 포인터가 우선한다.

## Soft Lock

```yaml
locked_by: jeongho
locked_step: script
locked_at: 2026-08-23T10:00:00+09:00
```

MVP에서는 표시용 메타데이터로 유지한다. 강제 잠금 명령은 후속 버전에서 구현한다.

