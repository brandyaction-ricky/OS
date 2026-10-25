import { expect, test } from "@playwright/test";

test("local demo edits portrait diagram labels and returns to image mode", async ({page}) => {
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/content/make?project=demo-p9");
  await page.getByRole("button",{name:/직접 쓰기/}).click();
  const row=page.locator(".yp-scn").first();
  const select=row.getByRole("combobox",{name:"화면 소재"});
  await select.selectOption("lib_timeline");
  for(let i=1;i<=3;i++)await row.getByLabel(`시점 ${i}`,{exact:true}).fill(["시작","변화","결과"][i-1]);
  await expect(row.getByLabel("시점 2",{exact:true})).toHaveValue("변화");
  await select.selectOption("lib_two_cards");
  await row.getByLabel("위 카드",{exact:true}).fill("기존");
  await row.getByLabel("아래 카드",{exact:true}).fill("개선");
  await select.selectOption("lib_iceberg");
  await row.getByLabel("수면 위",{exact:true}).fill("행동");
  await row.getByLabel("수면 아래",{exact:true}).fill("욕구");
  await expect(row.getByLabel("수면 아래",{exact:true})).toHaveValue("욕구");
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:"local-artifacts/diagram-editor-mobile.png",fullPage:true});
  await select.selectOption("image");
  await expect(row.getByLabel("수면 아래",{exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
