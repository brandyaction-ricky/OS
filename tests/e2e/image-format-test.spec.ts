import { openWorkTools } from "./image-approval-steps";
import { expect, test } from "@playwright/test";

test("작업 전에 고른 디자인을 새 작업으로 이어가고 기존 포맷 승인을 거친다", async ({page})=>{
  await openWorkTools(page);
  const catalog=page.getByRole("region",{name:"광고 디자인 고르기"});
  await expect(catalog.getByRole("status")).toHaveText("5개 디자인");
  await expect(catalog.getByRole("button",{name:"이 디자인으로 작업 시작"})).toBeDisabled();
  await catalog.getByRole("checkbox").uncheck();
  await expect(catalog.getByRole("status")).toHaveText("73개 디자인");
  await catalog.getByRole("checkbox").check();
  await catalog.getByRole("button",{name:"5개 디자인 모두 선택"}).click();
  await expect(catalog.getByText("선택한 디자인 5개",{exact:true})).toBeVisible();
  await catalog.getByRole("button",{name:"이 디자인으로 작업 시작"}).click();
  await expect(page.getByLabel("새 작업 이름",{exact:true})).toBeFocused();
  for(const [field,value] of Object.entries({"새 작업 이름":"포맷 비교","브랜드명":"공방","소재 목표":"예약 증가","퍼널":"첫 방문","대상":"직장인","상품":"공방 수업","제공 내용":"수업 예약"})) {
    await page.getByLabel(field,{exact:true}).fill(value);
  }
  await page.getByRole("button",{name:"새 작업 만들기"}).click();
  await expect(catalog.getByText("선택한 디자인 5개",{exact:true})).toBeVisible();
  await catalog.getByRole("button",{name:"다음: 광고 내용 입력"}).click();
  await expect(page.locator("#image-brief-title")).toBeFocused();
  await expect(page.getByRole("group",{name:"창고 디자인 · 피드 4:5"}).getByRole("checkbox",{checked:true})).toHaveCount(5);
  await expect(page.getByRole("button",{name:"내 AI에게 맡기기"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"PNG 5장 ZIP"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"이 작업에 묶음 저장"})).toHaveCount(0);
});

test("기존 저장 묶음은 승인 없이 내려받지 못하고 반려 사유와 재확인 순서를 유지한다", async ({page})=>{
  const {emptyImageCreative}=await import("../../lib/image-creative/model");
  const state=emptyImageCreative();
  const id="00000000-0000-4000-8000-000000002341";
  state.variants=[{id:"v1",formatId:"typography",formatVersion:1,size:"portrait",appeal:{id:"gift",meaning:"직접 만드는 선물"},copy:{headline:"하나뿐인 내 시계",body:"내가 원하는 시곗바늘을 골라요.",cta:"예약하기"},at:"",by:"직원"}];
  state.batches=[{id:"b1",mode:"initial",count:1,formatIds:["typography"],copyFields:[],variantIds:["v1"],at:""}];
  state.selectedId="v1";
  await openWorkTools(page);
  await page.evaluate(({id,state})=>localStorage.setItem("os-image-creatives-demo-v1",JSON.stringify([{project:{id,title:"승인 도입 전 작업",version:1},state,assets:[],jobs:[]}])),{id,state});
  await page.goto("/content/images?project="+id);
  const group=page.getByRole("region",{name:"1번째 묶음 검토"});
  await expect(group.getByText("포맷 승인 대기",{exact:true})).toBeVisible();
  await expect(group.getByRole("button",{name:"내보내기",exact:true})).toHaveCount(0);
  await group.getByRole("button",{name:"묶음 포맷 승인"}).click();
  await expect(group.getByText("내가 원하는 시곗바늘을 골라요.",{exact:true})).toBeVisible();
  await expect(group.getByRole("img")).toHaveCount(0);
  await group.getByRole("button",{name:"수정 요청",exact:true}).click();
  await group.getByLabel("수정 사유").fill("CTA 검토");
  await group.getByRole("button",{name:"수정 요청 보내기"}).click();
  await group.getByText("검토 이력",{exact:true}).click();
  await expect(group.getByText(/CTA 검토/)).toBeVisible();
  await group.getByRole("button",{name:"카피 승인",exact:true}).click();
  await group.getByRole("button",{name:"미리보기 확인 · 체험 출력"}).click();
  await group.getByRole("button",{name:"수정 요청",exact:true}).click();
  await group.getByLabel("수정 사유").fill("글자 여백 확인");
  await group.getByRole("button",{name:"수정 요청 보내기"}).click();
  await expect(group.getByText("미리보기 확인 대기",{exact:true})).toBeVisible();
  await expect(group.getByRole("button",{name:"최종 검수 완료",exact:true})).toHaveCount(0);
  await expect(group.getByRole("button",{name:"내보내기",exact:true})).toHaveCount(0);
});
