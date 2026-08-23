# 자주 생기는 문제

## `ba: command not found`

가상환경을 활성화한다.

```bash
source .venv/bin/activate
```

또는 설치 없이 저장소 안에서 실행한다.

```bash
./bin/ba status
```

## `E_REPO_NOT_FOUND`

터미널이 OS 저장소 밖에 있다. `OS` 폴더로 이동한 뒤 다시 실행한다.

```bash
cd OS
ba doctor
```

## `E_REMOTE_NEWER` 또는 `E_REPOSITORY_BEHIND`

다른 사람이 먼저 Push했다. `.workspace/CONTENT_ID/output/`의 내 결과를 별도 보존한 뒤 최신화한다.

```bash
ba sync
ba pull CONTENT_ID --force
```

보존한 결과를 새 output 파일에 다시 반영하고 Push한다. 자동 병합은 하지 않는다.

## `E_GIT_PUSH`

로컬 commit은 만들어졌지만 GitHub 인증 또는 권한 문제로 원격 반영이 실패했다. GitHub 접근 권한과 로그인 상태를 확인한 뒤 같은 `ba push` 명령을 다시 실행한다.

## `E_WORKSPACE_EXISTS`

이미 작업 중인 Workspace가 있다. 기존 output을 확인하지 않고 `--force`를 사용하면 작업 파일이 지워질 수 있다. 먼저 `.workspace/CONTENT_ID/output/`을 확인한다.

## 무엇을 해야 할지 모르겠을 때

```bash
ba doctor
ba guide
ba status
ba guide CONTENT_ID
```
