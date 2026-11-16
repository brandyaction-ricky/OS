import assert from "node:assert/strict";
import test from "node:test";
import { prepareMasterLayout } from "../lib/image-creative/analyze-master.ts";
import { photoCaptionLayout } from "../lib/image-creative/analyze-photo-caption.ts";
import { draftReferenceLayout, referenceCopyProblems } from "../lib/image-creative/reference-layout.ts";

// Build two different page sizes and type positions without storing an advertiser's creative.
function captionPage(width,height,headerEnd,captionStart) {
  const rgba = new Uint8ClampedArray(width*height*4);
  const ink = (x,y,left,right,top,bottom) => x>=left && x<right && y>=top && y<bottom && x%4!==0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const u=x/width, v=y/height;
    const texture = 24+((x*13 + y*5)%27);
    const paper = v<headerEnd ? 5 : v<captionStart ? texture : 16;
    let rgb=[paper,paper,paper];
    if (ink(x,v,width*.08,width*.39,headerEnd*.32,headerEnd*.32+.029) ||
        ink(x,v,width*.11,width*.78,captionStart,captionStart+.043) ||
        ink(x,v,width*.11,width*.85,captionStart+.074,captionStart+.118) ||
        ink(x,v,width*.52,width*.90,.902,.93)) {
      rgb = v>=captionStart && v<captionStart+.043 && u>.42 ? [248,188,88] : [248,248,248];
    }
    rgba.set([...rgb,255],4*(y*width+x));
  }
  return rgba;
}

test("detects the source masthead, caption and footer; clears foreign artwork even with no product brand", () => {
  for (const [width,height,headerEnd,captionStart] of [[360,380,.09,.62],[420,320,.14,.68]]) {
    const initial=draftReferenceLayout({path:"source.png",w:width,h:height});
    const pixels=captionPage(width,height,headerEnd,captionStart);
    // Antialiasing darkens one text-adjacent row differently across image decoders.
    const beforeType=Math.ceil(headerEnd*.32*height)-1;
    for(let x=0;x<width*.3;x++) pixels.set([40,40,40,255],4*(beforeType*width+x));
    const found=photoCaptionLayout(pixels,width,height,initial,"브랜드");
    assert.equal(found?.master.base,"solid");
    assert.equal(found.master.headlineAccent,"#f8b858");
    assert.equal(found.photo.w,100);
    assert.ok(Math.abs(found.photo.y-headerEnd*100)<1);
    assert.ok(Math.abs(found.headline.y-captionStart*100)<4);
    assert.ok(found.headline.fontSize>found.body.fontSize);
    assert.equal(found.cta.align,"right");
    assert.equal(found.master.brandSlots.length,1);
    const noBrand=photoCaptionLayout(pixels,width,height,initial);
    assert.equal(noBrand.master.brandSlots,undefined);
    assert.deepEqual(noBrand.master.regions,found.master.regions);
    assert.deepEqual(referenceCopyProblems(noBrand,{headline:"어떤 순간에 가장 집중하나요?",body:"내 답변으로 결과를 확인해 보세요.",cta:"지금 알아보기"}),[]);
    assert.equal(photoCaptionLayout(new Uint8ClampedArray(pixels.length),width,height,initial),undefined);
  }
});

test("unrecognized uploads recompose owned assets; manual tracing retains the editable original", async t => {
  const initial=draftReferenceLayout({path:"unregistered.png",w:121,h:139});
  const image={naturalWidth:121,naturalHeight:139};
  t.after(()=>{delete globalThis.document;});
  globalThis.document={createElement:()=>({getContext:()=>({
    fillRect(){},drawImage(){},getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(245)}),
  })})};
  const automatic=await prepareMasterLayout(image,initial);
  assert.ok(automatic.composition);
  const manual=await prepareMasterLayout(image,initial,undefined,"edit-original");
  assert.equal(manual.composition,undefined);
  assert.ok(manual.master);
});
