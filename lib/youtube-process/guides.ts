import type { PageGuideDefinition } from "../page-guides";

// Text from 00_개발지시서 부록 C. Kept apart from PAGE_GUIDES, whose count and snapshot are fixed by tests.
export const YOUTUBE_V1_GUIDES: Record<string, PageGuideDefinition> = {
  "/content/projects": { steps: ["새 프로젝트를 누르고 주제를 써요", "최근 6개만 보여요. 나머지는 검색해요", "줄을 누르면 그 프로젝트의 지금 단계가 열려요"], next: "/content/plan" },
  "/content/plan": { steps: ["주제 → 기획안 → 구성안 순서로 채워요", "주제와 기획안은 담당 PD가 컨펌하고, 대표는 알림을 받아요", "구성안은 컨펌 없이 제작으로 넘어가요"], next: "/content/make" },
  "/content/make": { steps: ["편집 완료 일정을 먼저 정해요", "진행 상태를 눌러 바꿔요", "최종본과 최종 썸네일 A · B를 올리면 완료돼요"], next: "/content/final-check" },
  "/content/final-check": { steps: ["영상을 멈추고 그 시간에 피드백을 남겨요", "썸네일 탭에서 A · B · C를 같이 봐요", "다 보면 최종 검토를 컨펌해요"], next: "/content/upload" },
  "/content/upload": { steps: ["1 ~ 5번 칸을 순서대로 채워요", "설명란은 내 AI로 만들고 다듬어요", "[업로드]를 한 번 누르면 유튜브와 백업이 같이 돼요"], next: "/content/schedule" },
  "/content/schedule": { steps: ["편집 완료와 업로드(예상)를 한눈에 봐요", "끌어서 날짜를 옮겨요", "업로드는 편집 완료보다 앞으로 못 옮겨요"], next: "/content/projects" },
  "/content/confirm": { steps: ["PD가 컨펌한 것이 새것부터 보여요", "보고 노트를 남기면 PD에게 알림이 가요", "꼭 필요할 때만 [결정 되돌리기]로 그 단계에 돌려보내요"], next: "/content/projects" },
  "/content/voice-dictionary": { steps: ["읽기 사전에 원래 말과 읽는 소리를 넣어요 (원고 · 자막은 그대로)", "「자동 수집 · 확인 필요」 줄은 맞음 · 고치기 · 지우기로 정리해요", "끊김 시험 문제는 음성 만드는 방식을 바꿀 때 모두 통과해야 하는 문장이에요"], next: "/content/projects" },
  "/content/links": { steps: ["브랜드·원본 주소·사용처를 넣고 유입 출처·마케팅 방식·캠페인명을 골라요 (없으면 바로 추가)", "[UTM 링크 만들기]를 누르면 링크 대장과 회사 문서에 남아요", "필요하면 [단축링크 만들기]로 마이인 단축 링크도 붙여요"], next: "/content/projects" },
  "/content/overview": { steps: ["위 「확인 필요」를 눌러 고를 것을 오른쪽에서 봐요", "보라색 줄은 AI가 일하는 중, 빨간 줄은 막힌 일이에요", "줄을 누르면 지금 상태와 화면 열기가 나와요"], next: "/content/projects" },
  "/content/card-canon": { steps: ["시험 묶음에 원본 3~5개를 넣어요", "[이 정본으로 다시 뽑기]로 지금 정본의 초안을 받아요", "칸을 눌러 평가표로 채점하고, 고칠 점을 보고 정본을 고쳐요"], next: "/content/projects?platform=card" },
  "/content/threads-canon": { steps: ["내가 확정한 스레드 주제를 시험 묶음에 3~5개 넣어요 (넣은 주제의 재료는 팀에 보여요)", "[이 정본으로 다시 뽑기]로 지금 정본의 글타래를 받아요", "칸을 눌러 정본의 검수 관문 여섯 가지로 채점하고, 고칠 점을 보고 정본을 고쳐요"], next: "/automation/topics" },
  "/content/column-canon": { steps: ["원고를 확정한 롱폼을 시험 묶음에 3~5개 넣어요", "[이 정본으로 다시 뽑기]로 지금 정본의 SEO 칼럼을 받아요", "칼럼을 올리는 작업자가 칸을 눌러 평가표 여섯 가지로 채점하고, 고칠 점을 보고 정본에 변경 제안을 보내요"], next: "/content/projects?platform=longform" },
  "/content/script-canon": { steps: ["롱폼 구성안 단계에서 원고마다 두 번째 검수를 받아요", "정본 묶음마다 관문 2~6 통과율과 반려된 원고를 봐요", "원고 2편 이상에서 반려된 관문(정본 문제)을 보고 원고 정본을 고쳐요"], next: "/content/projects?platform=longform" },
  "/content/short-canon": { steps: ["대본을 확정한 숏폼을 시험 묶음에 3~5개 넣어요", "[이 정본으로 다시 뽑기]로 지금 정본의 대본을 받아요", "칸을 눌러 정본 판정 검사 여섯 가지로 채점하고, 고칠 점을 보고 정본을 고쳐요"], next: "/content/projects?platform=short" },
};
