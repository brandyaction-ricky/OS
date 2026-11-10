import { expect, type Page } from "@playwright/test";

export async function approveFormat(page: Page) {
  await page.getByRole("button",{name:"포맷 승인",exact:true}).click();
  await expect(page.getByRole("button",{name:"포맷 승인됨",exact:true})).toBeDisabled();
}
export async function finishDemoBatch(page: Page, n: number, savedRevision=false) {
  const group=page.getByRole("region",{name:n+"번째 묶음 검토",exact:true});
  if(savedRevision) await group.getByRole("button",{name:"묶음 포맷 승인"}).click();
  await expect(group.getByRole("img")).toHaveCount(0);
  await expect(group.getByRole("button",{name:"내보내기",exact:true}).first()).toBeDisabled();
  await group.getByRole("button",{name:"카피 승인",exact:true}).click();
  await group.getByRole("button",{name:"미리보기 확인 · 체험 출력",exact:true}).click({timeout:45000});
  await expect(group.getByRole("button",{name:"내보내기",exact:true}).first()).toBeDisabled();
  await group.getByRole("button",{name:"최종 검수 완료",exact:true}).click({timeout:45000});
  await expect(group.getByRole("button",{name:"내보내기",exact:true}).first()).toBeEnabled({timeout:45000});
}
