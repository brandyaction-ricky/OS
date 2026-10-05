# 선행 A/B 화면의 통합 QA 증거

A·B·C·D·E·G를 포함한 H 후보에서 다시 촬영한 로컬 데모입니다. 선행 PR125/126의 원래 커밋 화면으로 오인하지 않도록 이 출처를 명시합니다. 프로필을 가렸으며 실제 직원·운영 데이터가 없습니다. 전체 브라우저 60개 통과·실계정 1개 생략. 가로 넘침 없음. 기존 A/B의 로컬 캡처를 외부 게시하지 않고 이 통합 캡처를 PR에 첨부합니다.

| 화면 | 다크 1440 | 밝은 1440 | 다크 390 | 밝은 390 |
|---|---|---|---|---|
| 작동 상태 | [보기](status-dark-1440.png) | [보기](status-light-1440.png) | [보기](status-dark-390.png) | [보기](status-light-390.png) |
| 데이터 연결 | [보기](data-dark-1440.png) | [보기](data-light-1440.png) | [보기](data-dark-390.png) | [보기](data-light-390.png) |
| 콘텐츠 종류 | [보기](uiux-hygiene-dark-1440.png) | [보기](uiux-hygiene-light-1440.png) | [보기](uiux-hygiene-dark-390.png) | [보기](uiux-hygiene-light-390.png) |
| 키 권한 | [보기](uiux-key-dark-1440.png) | [보기](uiux-key-light-1440.png) | [보기](uiux-key-dark-390.png) | [보기](uiux-key-light-390.png) |

기존 PR78의 개발 전용 영상 자동화와 관련 diff도 읽었습니다. generic route, radar props, 제작 자료 준비 방식, pipeline panel과 navigation이 겹칩니다. PR78은 패키징 선행·촬영 진행표·음성/이미지 작업을 추가하므로 병합 시 UIUX의 다음 작업 분류와 별도로 공정 규칙 및 메뉴를 통합 검토해야 합니다. 이번 후보에는 PR78을 병합하지 않았으며 두 후보의 통합 검증을 완료했다고 주장하지 않습니다. PR120 핫비디오, PR121 Daily Brief 역시 자동 전체 병합하지 않았습니다.
