export const CONTENT_STATUS_LABELS:Record<string,string>={
  draft:"제작 중",making:"제작 중",ai:"AI 작업 중",arrived:"AI 결과 도착",
  review:"확인 대기",blocked:"고칠 것",changes:"고칠 것",
  ready:"발행 준비",scheduled:"게시 예정",published:"게시됨",
};
export const JOB_STATUS_LABELS:Record<string,string>={
  backlog:"대기",queued:"대기",active:"처리 중",running:"처리 중",
  completed:"결과 도착",failed:"막힘",adopted:"반영 완료",
  rejected:"채택 안 함",cancelled:"닫음",
};
export const CHANNEL_LABELS:Record<string,string>={card:"카드뉴스",shorts:"쇼츠",threads:"쓰레드"};
export const PROC_LABELS:Record<string,string>={
  topic:"주제 후보 찾기",brief:"브리프 초안","card-fill":"카드뉴스 글 채우기",
  "card-caption":"카드뉴스 캡션",image:"이미지 요청서","shorts-cut":"쇼츠 컷 구성",
  "shorts-desc":"쇼츠 커버·설명",threads:"쓰레드 글타래 초안",
  review:"최종 확인 자가검수",reply:"답글 초안",
};
