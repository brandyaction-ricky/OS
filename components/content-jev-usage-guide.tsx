type ContentJevUsageGuideProps = {
  steps: Array<{ title: string; description: string }>;
};

export const topicJevUsageSteps: ContentJevUsageGuideProps["steps"] = [
  { title: "입력 내용을 채워요", description: "주제 설명·대표 시청자·근거를 먼저 정리해 주세요." },
  { title: "점수와 보완점을 봐요", description: "타깃 고민·시청자 질문·도움·근거·새로운 답을 살펴봐요." },
  { title: "기획은 직접 판단해요", description: "근거를 확인해 내용을 보완하고 다음 단계로 넘길지 결정해요." },
];

export const packagingJevUsageSteps: ContentJevUsageGuideProps["steps"] = [
  { title: "후보를 하나씩 채택해요", description: "제목 1개와 썸네일 카피 1개가 기준이 됩니다." },
  { title: "점수와 과장 위험을 봐요", description: "주제 적합성·썸네일 이해·궁금증·근거와 표현을 살펴봐요." },
  { title: "문구는 직접 다듬어요", description: "의견을 참고해 고치고, 최종 선택은 사람이 해요." },
];

export function ContentJevUsageGuide({ steps }: ContentJevUsageGuideProps) {
  return <div className="content-jev-guide" aria-label="JEV 사용 방법">
    <h3>이렇게 사용해요</h3>
    <ol>
      {steps.map((step, index) => <li key={step.title}>
        <span aria-hidden="true">{index + 1}</span>
        <div><strong>{step.title}</strong><p>{step.description}</p></div>
      </li>)}
    </ol>
  </div>;
}
