import test from "node:test";
import assert from "node:assert/strict";
import { campaignTrackingUrl } from "../lib/ad-campaign.ts";
import { imageBriefSchema } from "../lib/image-creative/direction.ts";
import { sameImageBrief } from "../lib/image-creative/model.ts";

test("image and video share the campaign, preserving unrelated landing query and fragment",()=>{
  const id="11111111-1111-4111-8111-111111111111";
  const landing="https://example.test/book?edition=3&utm_source=stale#start";
  const video=new URL(campaignTrackingUrl(landing,id,"video"));
  const image=new URL(campaignTrackingUrl(landing,id,"image"));
  for(const url of [video,image]){
    assert.equal(url.searchParams.get("utm_campaign"),id);
    assert.equal(url.searchParams.get("utm_source"),"meta");
    assert.equal(url.searchParams.get("edition"),"3");
    assert.equal(url.hash,"#start");
  }
  assert.notEqual(image.searchParams.get("utm_content"), video.searchParams.get("utm_content"));
  assert.equal(campaignTrackingUrl("http://example.test",id,"video"),"");
  const legacy={product:"진단",audience:"직장인",offer:"결과지",objective:"진단 시작",facts:"",funnel:""};
  const linked=imageBriefSchema.parse({...legacy,campaignId:id,hypothesis:"가설",successCriterion:"평가 기간",budget:"일 1만 원"});
  assert.equal(linked.campaignId,id);
  assert.equal(sameImageBrief(legacy,linked),false);
  assert.equal(sameImageBrief(legacy,imageBriefSchema.parse(legacy)),true);
});
