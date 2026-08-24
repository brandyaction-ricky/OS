# Folder Structure v1.0

```text
brandyaction-os/
├─ 00_system/        # Schema / 공통 규칙 / Template
├─ 01_company/       # 회사 정본
├─ 02_brands/        # 브랜드별 정본
├─ 03_processes/     # 업무 공정 정의
├─ 04_skills/        # Skill Registry
├─ 05_contents/      # 실제 Content Run
├─ 06_meetings/     # 회사 공용 회의 Inbox · 정리본 · 의사결정 기록
├─ 07_automations/   # API·Worker·사람 확인 실행 Recipe
├─ 08_people/        # 직원별 공유 Workspace와 담당 업무 연결
├─ 10_wiki/          # 회사·공정·직원 공유 Wiki 최신 정본
├─ bin/              # 설치 전 CLI 실행기
├─ src/              # BA CLI 구현
└─ tests/
```

## Skill Library

```text
04_skills/
├─ CATEGORIES.json
└─ content-production/
   ├─ planning/{skill_id}/
   ├─ writing/{skill_id}/
   ├─ video/{skill_id}/
   └─ publishing/{skill_id}/
```

카테고리와 폴더는 탐색과 책임 영역을 표현하고, `skill_id`는 Process가 참조하는 고유 키로 유지한다. CLI는 경로를 하드코딩하지 않고 `SKILL.md`의 `skill_id`를 재귀 탐색한다.

## People / Wiki

```text
08_people/
└─ {person}/WORKSPACE.md

10_wiki/
├─ company/{wiki_id}/WIKI_vN.md
├─ process/{process_id}/{step_id}/WIKI_vN.md
└─ people/{person}/{wiki_id}/WIKI_vN.md
```

개인 Raw와 개인 전용 Wiki는 각자의 Obsidian에 둔다. 회사 OS에는 공유된 최신 Wiki, 직원별 담당 업무와 공정 연결만 저장한다.

## Automation Recipe

```text
07_automations/
└─ {recipe_id}/
   ├─ RECIPE.md
   └─ templates/
```

Skill은 최신 Context를 불러오고, Automation Recipe는 실제 API·Worker·사람 확인을 실행한다. 실행 중 상태는 Content Run의 `automation/state.json`에 두고, 결과 본문은 Markdown 버전으로 누적한다.

## Meeting Notes

```text
06_meetings/
├─ inbox/{MEETING_ID}.md
├─ organized/{year}/{MEETING_ID}.md
└─ decisions/{year}/{MEETING_ID}.md
```

회의 메모는 개인 Raw가 아니라 회사 공용 업무 기록이다. 작성 중에는 `inbox`, 정리 완료 후에는 `organized`, 명시적인 의사결정 기록은 `decisions`로 이동한다. 녹음 원본은 Repository에 저장하지 않고 전사·요약된 Markdown만 저장한다.

## Content Run

```text
05_contents/BA-0268/
├─ CONTENT.md
├─ 01_package/
├─ 02_axis/
├─ 03_script/
├─ 04_shoot/
├─ 05_edit/
│  └─ automation/state.json
├─ 06_thumbnail/
├─ 07_approval/
├─ 08_publish/
└─ 09_metrics/
```

`CONTENT.md`는 콘텐츠의 현재 상태를 대표하는 인덱스다. 대용량 MP4/PNG/WAV는 Asset Storage에 두고 Markdown에는 `asset_id`, path, checksum을 저장한다.
