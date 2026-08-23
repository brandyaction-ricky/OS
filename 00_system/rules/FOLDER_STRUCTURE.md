# Folder Structure v1.0

```text
brandyaction-os/
├─ 00_system/        # Schema / 공통 규칙 / Template
├─ 01_company/       # 회사 정본
├─ 02_brands/        # 브랜드별 정본
├─ 03_processes/     # 업무 공정 정의
├─ 04_skills/        # Skill Registry
├─ 05_contents/      # 실제 Content Run
├─ 06_meetings/
├─ 07_kpi/
├─ 08_people/
├─ bin/              # 설치 전 CLI 실행기
├─ src/              # BA CLI 구현
└─ tests/
```

## Content Run

```text
05_contents/BA-0268/
├─ CONTENT.md
├─ 01_package/
├─ 02_axis/
├─ 03_script/
├─ 04_shoot/
├─ 05_edit/
├─ 06_thumbnail/
├─ 07_approval/
├─ 08_publish/
└─ 09_metrics/
```

`CONTENT.md`는 콘텐츠의 현재 상태를 대표하는 인덱스다. 대용량 MP4/PNG/WAV는 Asset Storage에 두고 Markdown에는 `asset_id`, path, checksum을 저장한다.

