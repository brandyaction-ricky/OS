import { expect, test } from "@playwright/test";

test("반응·성과에서 콘텐츠 자동화를 통해 이미지 광고와 A/B 프로젝트를 연다", async ({page}) => {
  await page.goto("/automation/performance");
  const group = page.getByRole("button", {name:"콘텐츠 자동화", exact:true});
  await expect(group).toBeVisible();
  if (await group.getAttribute("aria-expanded") === "false") await group.click();
  await page.locator('[data-stage="automation"]').getByRole("link", {name:"이미지 광고", exact:true}).click();
  await expect(page.getByRole("navigation", {name:"현재 위치"}).getByRole("link", {name:"콘텐츠 자동화"})).toBeVisible();
  await page.getByRole("button", {name:"여러 안 테스트하기", exact:true}).click();
  await expect(page.getByRole("heading", {name:"A/B 테스트 프로젝트", exact:true})).toBeVisible();
  await expect(page.locator('[data-stage="automation"] a.page-link[aria-current="page"]')).toHaveText("이미지 광고");
});

test("첫 화면은 모바일에서도 한 장 제작과 여러 안 테스트를 바로 시작할 수 있다", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/content/images");
  for (const title of ["광고 한 장 만들기", "여러 안 테스트하기"]) {
    const button = page.getByRole("button", {name:title, exact:true});
    await expect(button).toBeInViewport();
  }
  await expect(page.getByRole("region",{name:"포맷 창고"})).toHaveCount(0);
  await expect(page.getByLabel("이미지를 출력할 컴퓨터")).toHaveCount(0);
  await page.getByRole("button",{name:"광고 한 장 만들기", exact:true}).click();
  await expect(page.getByRole("heading",{name:"상품 선택",exact:true})).toBeVisible();
  await expect(page.getByLabel("메인 메시지",{exact:true})).toHaveCount(0);
  await expect(page.getByLabel("소구점 수")).toHaveCount(0);
});

test("단독 광고를 소구점 직접 작성부터 디자인 수정과 최종 확정까지 진행한다", async ({page})=>{
  await page.goto("/content/images");
  await page.getByRole("button",{name:"광고 한 장 만들기",exact:true}).click();
  await page.getByRole("combobox",{name:"상품 선택",exact:true}).selectOption("__demo");
  await page.getByRole("button",{name:"소구점 선택하기",exact:true}).click();
  await expect(page.getByRole("button",{name:"AI에게 추천받기",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"직접 작성",exact:true}).click();
  const motive="퇴근 후 직접 만든 컵으로 쉬고 싶다";
  await page.getByLabel("소구점 직접 작성",{exact:true}).fill(motive);
  await page.getByRole("button",{name:"레퍼런스 선택하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"레퍼런스 선택",exact:true})).toBeVisible();
  await page.reload();
  const card=page.getByRole("button",{name:"짧은 문장 포스터",exact:true});
  await expect.poll(()=>card.getByRole("img").evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("button",{name:"카피 작성하기",exact:true})).toBeDisabled();
  await page.getByText(/다른 레퍼런스 [0-9]+개 보기/).click();
  await page.getByRole("button",{name:"썸네일형 · 한 장면",exact:true}).click();
  await page.getByLabel("이미지 올리기").setInputFiles("public/image-format-test/master.jpg");
  await expect(page.getByRole("radio",{name:"등록 이미지 1",exact:true})).toBeChecked();
  await card.click();
  await page.getByRole("radio",{name:"사진 없이 제작",exact:true}).check();
  await page.getByRole("button",{name:"카피 작성하기",exact:true}).click();
  await page.getByLabel("제목",{exact:true}).fill("내가 빚은 컵");
  await page.getByLabel("본문",{exact:true}).fill("퇴근 후 공방에서 쉬어가요");
  await page.getByLabel("버튼 문구",{exact:true}).fill("예약하기");
  await expect(page.getByRole("button",{name:"최종 검수 완료",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"카피 확정 · 디자인 수정하기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"디자인 수정",exact:true})).toBeVisible();
  const review=page.getByRole("region",{name:"1번째 묶음 검토",exact:true});
  await expect(review.getByText(motive,{exact:true})).toBeVisible();
  await expect(review.getByText("퇴근 후 공방에서 쉬어가요",{exact:true})).toBeVisible();
  await review.getByRole("button",{name:"디자인 편집",exact:true}).click();
  const editor=page.getByRole("region",{name:"디자인 편집",exact:true});
  await editor.getByLabel("제목 글꼴").selectOption("serif");
  await editor.getByRole("button",{name:"수정본 저장",exact:true}).click({timeout:45000});
  const revision=page.getByRole("region",{name:"2번째 묶음 검토",exact:true});
  await expect(revision.getByText(/명조 · 고운바탕/)).toBeVisible();
  await expect(revision.getByText("내가 빚은 컵",{exact:true})).toBeVisible();
  await expect(revision.getByRole("button",{name:"묶음 포맷 승인",exact:true})).toHaveCount(0);
  await revision.getByRole("button",{name:/미리보기 확인.*체험 출력/}).click({timeout:45000});
  await expect(page.getByRole("heading",{name:"확정",exact:true})).toBeVisible();
  await revision.getByRole("button",{name:"최종 검수 완료",exact:true}).click();
  await expect(revision.getByRole("button",{name:"내보내기",exact:true})).toBeEnabled();
  await page.reload();
  await expect(revision.getByText("최종 검수 완료",{exact:true})).toBeVisible();
});
