# BA CLI v0.2

## 구현 명령

```bash
ba setup [--user USER] [--email EMAIL]
ba doctor [--offline]
ba sync
ba guide [CONTENT_ID]
ba status [CONTENT_ID]
ba pull CONTENT_ID [--step STEP]
ba skill CONTENT_ID [SKILL_ID]
ba push CONTENT_ID [--step STEP]
ba validate [PATH ...]
ba new content --type longform
```

## 공통 원칙

- Git 명령을 팀원에게 직접 요구하지 않는다.
- upstream이 있으면 Pull/Push 전에 원격 최신 상태를 확인한다.
- 충돌 시 자동 merge나 자동 덮어쓰기를 하지 않는다.
- `--offline`은 네트워크 검사를 생략하지만 로컬 Git commit은 남긴다.
- 작업자는 `--by`, `BA_USER`, `.ba/config.json`, Git 사용자명 순으로 결정한다.
- 팀원은 `git pull` 대신 `ba sync`로 fast-forward 최신화한다.

## 종료 코드

- `0`: 성공 또는 Validator 통과
- `1`: 업무 규칙, 충돌, Schema, Git 오류
- `2`: 잘못된 CLI 사용법
- `130`: 사용자 중단
