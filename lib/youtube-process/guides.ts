import type { PageGuideDefinition } from "../page-guides";

// Text from 00_개발지시서 부록 C. Kept apart from PAGE_GUIDES, whose count and snapshot are fixed by tests.
export const YOUTUBE_V1_GUIDES: Record<string, PageGuideDefinition> = {
  "/content/projects": { steps: ["새 프로젝트를 누르고 주제를 써요", "최근 6개만 보여요. 나머지는 검색해요", "줄을 누르면 그 프로젝트의 지금 단계가 열려요"], next: "/content/plan" },
  "/content/plan": { steps: ["주제 → 기획안 → 구성안 순서로 채워요", "주제와 기획안은 대표 컨펌을 받아요", "구성안은 컨펌 없이 제작으로 넘어가요"], next: "/content/make" },
  "/content/make": { steps: ["편집 완료 일정을 먼저 정해요", "진행 상태를 눌러 바꿔요", "최종본과 최종 썸네일 A · B를 올리면 완료돼요"], next: "/content/final-check" },
  "/content/final-check": { steps: ["영상을 멈추고 그 시간에 피드백을 남겨요", "썸네일 탭에서 A · B · C를 같이 봐요", "다 보면 최종 검수 컨펌을 요청해요"], next: "/content/upload" },
  "/content/upload": { steps: ["1 ~ 5번 칸을 순서대로 채워요", "설명란은 내 AI로 만들고 다듬어요", "[업로드]를 한 번 누르면 유튜브와 백업이 같이 돼요"], next: "/content/schedule" },
  "/content/schedule": { steps: ["편집 완료와 업로드(예상)를 한눈에 봐요", "끌어서 날짜를 옮겨요", "업로드는 편집 완료보다 앞으로 못 옮겨요"], next: "/content/projects" },
  "/content/confirm": { steps: ["오래 기다린 것부터 보여요", "OK · 수정 요청 · 보류 중에 골라요", "수정 요청은 고칠 칸을 체크하고 메모를 남겨요"], next: "/content/projects" },
};
