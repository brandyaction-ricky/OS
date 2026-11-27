import test from 'node:test';
import assert from 'node:assert/strict';
import { myinExample } from '../lib/cardnews/myin-example.ts';
import { myinEditableSchema, myinPreviewSchema } from '../lib/cardnews/myin-preview.ts';
import { cardProblems } from '../lib/cardnews/formats.ts';
import { productionSchema, productionOutline } from '../lib/cardnews/production.ts';
test('the actual eight-page MYIN proof satisfies all content constraints',()=>{
 const draft=myinExample(); assert.equal(draft.slides.length,8); assert.deepEqual(cardProblems(draft),{blocking:[],warnings:[]}); assert.ok(myinPreviewSchema.safeParse({draft}).success);
});
test('old production input keeps its old design, new choice survives outline creation',()=>{
 const {design,...old}=myinExample().production; assert.equal(productionSchema.parse(old).design,undefined);
 const next=productionOutline({...old,design},'draft','qa','now'); assert.equal(next.production.design,'myin-character');
});
test('unfinished editing can be restored but cannot export until fixed',()=>{
 const draft=myinExample(); draft.slides[0].fields.head=''; assert.ok(myinEditableSchema.safeParse({draft}).success); assert.equal(myinPreviewSchema.safeParse({draft}).success,false);
});
test('preview does not accept remote images, arbitrary storage paths, unknown fields, or out-of-range pages',()=>{
 const draft=myinExample();
 for(const input of [{draft,art:'https://example.com/file.png'},{draft,slide:8},{draft:{...draft,slides:[{...draft.slides[0],photo:{path:'other-project/private.png',w:10,h:10}},...draft.slides.slice(1)]}},{draft,admin:true}]) assert.equal(myinPreviewSchema.safeParse(input).success,false);
});
test('generated art and public report are explicitly assigned, not inferred from slide position',()=>{
 const draft=myinExample(); assert.equal(draft.slides[1].myinVisual,'observation'); assert.equal(draft.slides[5].myinVisual,'report'); assert.equal(draft.slides[2].myinVisual,undefined);
});
