import assert from "node:assert/strict";
import test from "node:test";
import { analyzeReferenceDesign } from "../lib/image-creative/analyze-reference.ts";
import { draftReferenceLayout, isReferenceLayout, referenceCopyProblems, referenceTextLines } from "../lib/image-creative/reference-layout.ts";

test("reference headlines balance Korean words and preserve authored breaks; saved originals retain their line breaks", () => {
  const layout = draftReferenceLayout({ path: "original.jpg", w: 1080, h: 1080 });
  const box = { ...layout.headline, w: 58, fontSize: 76 };
  const title = "빠른 선택을 도와주는 오늘의 지도";
  assert.deepEqual(referenceTextLines(box, title), ["빠른 선택을 도와", "주는 오늘의 지도"]);
  assert.deepEqual(referenceTextLines(box, title, "body"), ["빠른 선택을", "도와주는 오늘의", "지도"]);
  assert.deepEqual(referenceTextLines(box, title, "headline"), ["빠른 선택을", "도와주는", "오늘의 지도"]);
  assert.deepEqual(referenceTextLines(box, "주말  산책\n\n동네에서", "headline"), ["주말  산책", "", "동네에서"]);
  const unspaced = "가나다라마바사아자차카타파하";
  assert.deepEqual(referenceTextLines(box, unspaced, "headline"), ["가나다라마바사", "아자차카타파하"]);
});

test("image analysis distinguishes a framed product, a split panel and textured full-bleed art without requiring text", (t) => {
  const layout = draftReferenceLayout({ path:"reference.jpg", w:512, h:512 });
  let pixels;
  const context = { fillRect(){}, drawImage(){}, getImageData:()=>({ data:pixels }) };
  t.after(() => { delete globalThis.document; });
  globalThis.document = { createElement:()=>({ getContext:()=>context }) };
  function result(paint) {
    pixels = new Uint8ClampedArray(64*64*4);
    for (let i=0; i<64*64; i++) {
      const color = paint(i%64, Math.floor(i/64));
      pixels.set([color>>16, (color>>8)&255, color&255, 255], i*4);
    }
    const design = analyzeReferenceDesign({naturalWidth:512, naturalHeight:512}, layout);
    assert.equal(isReferenceLayout(design), true);
    return design.composition;
  }
  const texture = (x,y) => (x*96263+y*193979) & 0xffffff;
  const framed = result((x,y) => y<27 || x<4 || x>59 || y>58 ? 0xffffff : 0x251343);
  assert.equal(framed.style, "stack");
  assert.equal(framed.fit, "contain");
  assert.equal(framed.background, "#ffffff");
  const split = result((x,y) => x<32 ? texture(x,y) : 0xf5eedb);
  assert.equal(split.style, "split");
  assert.equal(split.imageSide, "start");
  assert.equal(split.imageShare, .5);
  const narrow = result((x,y) => x<24 ? texture(x,y) : 0xf5eedb);
  assert.equal(narrow.imageShare, .38);
  assert.equal(split.background, "#f5eedb");
  const photo = result(texture);
  assert.equal(photo.style, "overlay");
  assert.equal(photo.fit, "cover");
  assert.equal(photo.imageShare, undefined);
  assert.equal(photo.headlineWeight, 600);
  assert.equal(photo.buttonStyle, "text");
  const label = result((x,y) => y>=43 && y<=49 && x>14 && x<49 ? 0xef6011 : 0xffffff);
  assert.equal(label.buttonStyle, "square");
  assert.equal(layout.composition, undefined);
  assert.throws(()=>analyzeReferenceDesign({naturalWidth:0, naturalHeight:0}, layout));
});

test("new art direction validates its source separately from its destination text size", () => {
  const layout = draftReferenceLayout({ path: "source.png", w: 1080, h: 1080 });
  layout.headline.h = 1;
  const copy = { headline: "가볍게 달리는 아침", body: "공원의 산책길", cta: "길 찾기" };
  assert.equal(referenceCopyProblems(layout, copy).length, 1);
  const composition = {style:"split", background:"#123456", ink:"#FAFAFA", accent:"#BC1234", imageSide:"start", fit:"contain"};
  const directed = { ...layout, composition };
  assert.equal(isReferenceLayout(directed), true);
  assert.deepEqual(referenceCopyProblems(directed, copy), []);
  assert.equal(referenceCopyProblems({...directed, body:undefined}, copy).length, 1);
  assert.equal(isReferenceLayout({ ...layout, composition:{ ...composition, headlineWeight:600, buttonStyle:"text", focusX:0, focusY:100 } }),true);
  for (const invalid of [{ accent: "red" }, { style: "unknown" }, { extra: true }, { fit: undefined }, { imageSide: "up" },
    { headlineWeight:550 }, { buttonStyle:"pill" }, { focusX:Infinity }, { focusY:-1 }, { imageShare:.7 }, { imageShare:NaN }])
    assert.equal(isReferenceLayout({ ...layout, composition:{...composition, ...invalid} }), false);
  assert.equal(isReferenceLayout({ ...directed, headline:{ ...directed.headline, fill:"transparent" } }), false);
});

test("a single reference adapts across feed and story without moving controls when the appeal changes", async () => {
  const { composeReference } = await import("../lib/image-creative/reference-composition.ts");
  const { resolvePlacement } = await import("../lib/image-creative/placement.ts");
  const draft = draftReferenceLayout({path:"reference.png",w:340,h:600});
  const short = {headline:"취미를 담는 한 컷",body:"주말에 완성하는 나만의 작업",cta:"수업 보기"};
  const long = {...short,headline:"직접 찍은 사진으로 완성하는 나만의 작품"};
  for (const size of ["portrait","square","story"]) for (const style of ["stack","split","overlay"]) {
    const referenceLayout = {...draft,composition:{style,imageShare:.61,background:"#fffafa",ink:"#111111",accent:"#243038",imageSide:"end",fit:"contain"}};
    const first = composeReference({referenceLayout,size,copy:short}), second = composeReference({referenceLayout,size,copy:long});
    assert.deepEqual(second.issues,[]);
    assert.deepEqual(first.photo,second.photo);
    if(size==="story" && style!=="overlay") {
      const cover = composeReference({referenceLayout:{...referenceLayout,composition:{...referenceLayout.composition,fit:"cover"}},size,copy:long});
      assert.equal(cover.photo.y+cover.photo.h,cover.height);
      assert.ok(second.photo.y+second.photo.h<second.height);
      assert.deepEqual(cover.cta.box,second.cta.box);
    }
    assert.deepEqual(first.cta.box,second.cta.box);
    assert.deepEqual(first.body.box,second.body.box);
    assert.equal(first.headline.fontSize,second.headline.fontSize);
    const {safe} = resolvePlacement(size);
    for (const {box} of [second.headline,second.body,second.cta]) {
      assert.ok(box.x>=safe.x && box.y>=safe.y && box.x+box.w<=safe.x+safe.width && box.y+box.h<=safe.y+safe.height);
    }
  }
});
