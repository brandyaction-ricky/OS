# 광고 소재 UIUX 작업 분리

## 작업 기준

- 저장소: `brandyaction-ricky/OS`
- 작업 브랜치: `codex/ad-creative-uiux-20261127`
- 작업 위치: `/Users/ricky/Projects/brandyaction-os/.worktrees/ad-creative-uiux-20261127`
- 격리 방식: 원본의 Git 메타데이터 쓰기 제한으로 별도 `.git`을 가진 독립 clone 사용. 원본 저장소의 linked worktree가 아니다.
- 기준 브랜치: `origin/codex/ad-release-qa-20261124`
- 기준 커밋: `4efddc2905da704b3830ef45377ff9deb5b87c96`
- 시작 시 확인한 원격 main: `0ef7262f45668fa116cf8cfd83018657ea01d899`
- 광고 QA 브랜치는 원격 main에 없는 광고 구현 및 QA 보정 8커밋을 포함한다. main 쪽에만 있는 35커밋은 아직 통합하지 않았다. UI 변경 이후 병합 전 재확인해야 한다.
- 환경: 로컬, 자격 증명이 없는 demo 환경을 기준으로 준비. 서버 실행 및 외부 데이터 연결은 수행하지 않았다.

## 카드뉴스 작업 보호

- 확인한 카드뉴스 브랜치: `codex/card-information-meeting`
- 확인한 카드뉴스 커밋: `0fd5506fd1b8423484799460d2ec6a9dbcd79541`
- 해당 작업 공간의 브랜치, 파일, Git 설정을 변경하지 않는다.
- 코드, node_modules, 빌드 출력, 환경 파일을 기존 작업 공간과 심볼릭 링크로 공유하지 않는다.
- 브랜치 분리는 파일 덮어쓰기를 방지하지만 공통 파일의 향후 병합 충돌까지 없애지는 않는다.

## 광고 UIUX 우선 작업 범위

1. `components/ad-library.tsx`: 광고 목록, 검색, 상태/매체 필터, 새 광고 진입.
2. `components/ad-reference-photos.tsx`: 참고 사진 선택.
3. `components/ad-placement-preview.tsx`: 크기별 미리보기.
4. `components/ad-delivery.tsx`: 내보내기 및 집행 기록 화면.
5. `components/ad-production.css`: `.ad-*` 범위의 스타일.
6. 필요한 신규 광고 전용 컴포넌트/스타일 파일.

`lib/ad-production.ts`, `lib/ad-production-schema.ts`는 광고 전용 계약이지만 UI 작업만을 이유로 변경하지 않는다.

## 공유 파일 변경 전 재확인

- `components/image-creative-workspace.tsx`
- `components/reference-image-creation.tsx`
- `components/youtube-process-projects.tsx`
- `components/youtube-process-ads.tsx`
- `components/youtube-process-ai.tsx`, `youtube-process-data.ts`, `youtube-process-flow.tsx`
- `components/youtube-process-short*.tsx`
- `lib/ad-campaign.ts`
- `lib/image-creative/model.ts`, `lib/image-creative/direction.ts`
- `lib/server/image-creatives.ts`, `lib/server/youtube-process*.ts`
- `lib/youtube-process/project.ts`, `lib/youtube-process/navigation.ts`

공유 파일은 카드뉴스의 최신 diff를 다시 확인하고 수정 범위를 분리한 뒤 다룬다. 광고 목록은 기존 연결을 유지한 채 `AdLibrary` 내부에서 개선할 수 있다.

## 이번 작업 제외 범위

- 카드뉴스 제작 화면, `lib/cardnews/**`, 카드뉴스 서버 작업과 테스트.
- 캐릭터/카드뉴스 원본 이미지와 `next.config.ts`.
- 전역 CSS, 공통 내비게이션, DB 스키마, 실제 생성/발행/광고 집행.

## 완료 상태 및 검증

- 새 로컬 브랜치와 독립 Git 디렉터리 생성 확인.
- 광고 QA 기준 커밋과 체크아웃 일치 확인.
- 카드뉴스/광고 기존 브랜치 상태 및 수정 파일 경계 조사.
- 애플리케이션 코드 변경 없음. 이 문서는 작업 경계 및 착수 기록이다.
- UI 구현, lint/typecheck/build, 브라우저 QA는 아직 수행하지 않았다. 이번 단계는 작업 공간 분리이며 UI 동작 변경이 없기 때문이다.
- 원격 push/PR/배포 없음. Git push가 Preview를 생성할 수 있으므로 배포 상태를 별도로 확인해야 한다.
- OS 개발 관리 동기화: 대기. 이번 단계에서는 로컬 기록만 작성했다.

## 다음 단계

광고 목록 → 새 광고 → 견본/미리보기 → 최종 검토/내보내기 순서로 현행 동선을 확인하고 구체적인 UI 수정 범위를 정한다. 코드 변경 후 광고 관련 테스트와 필요한 카드뉴스 회귀 검증을 수행한다. 이 기록만으로 구현 또는 QA 완료를 의미하지 않는다.
