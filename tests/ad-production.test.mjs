import {test} from "node:test";
import assert from "node:assert/strict";
import {adCopyIssues,AD_COPY_RULES,adDisposition,evaluateAd,measurementIssue} from "../lib/ad-production.ts";
import {latestAdMeasurement} from "../lib/youtube-process/ad-results.ts";
import {campaignTrackingUrl} from "../lib/ad-campaign.ts";
test("six ad rules flag unverified claims and preserve checked facts",()=>{
  for (const [i,copy] of ["강점 12가지", "고민이 다 사라져요", "단 3일", "무료 진단 받기, 정밀 결과 구매하기", "결을 찾기", "당일 배송"].entries()) {
    assert.ok(adCopyIssues(copy,"").includes(AD_COPY_RULES[i]));
  }
  assert.deepEqual(adCopyIssues("강점 30가지 중 1위를 확인해요","강점 30가지 중 1위 제공"),[]);
});
test("a delivery receipt binds to a Meta library ID or a reason",()=>{
  const value="123456789012345678";
  assert.deepEqual(adDisposition({kind:"published",value:"https://www.facebook.com/ads/library/?id="+value}),{kind:"published",value});
  assert.equal(adDisposition({kind:"published",value:"123"}),undefined);
  assert.equal(adDisposition({kind:"withheld",value:"아직"}),undefined);
  assert.equal(adDisposition({kind:"withheld",value:"소재 교체 예정"}).kind,"withheld");
  const url=new URL(campaignTrackingUrl("https://example.com/?keep=1","autumn","image","4x5"));
  assert.equal(url.searchParams.get("utm_content"),"i4x5");assert.equal(url.searchParams.get("keep"),"1");
});
test("learning requires a mature attributed cohort and real net purchases",()=>{
  const m={from:"2026-01-01",to:"2026-01-07",impressions:1000,clicks:30,purchases:3,refundedOrders:1,spend:10000,otherCosts:2000,revenue:30000,refunds:8000,starts:80,completions:50,cohortConfirmed:true};
  assert.deepEqual(evaluateAd(m,false),{hold:"",cpa:6000,roas:2.2});
  for(const patch of [{from:"2026-01-02"},{clicks:29},{impressions:999},{cohortConfirmed:false},{purchases:1}]) assert.ok(evaluateAd({...m,...patch},false).hold);
  assert.ok(evaluateAd(m,true).hold);
});

test("the first minute of a Korean day accepts today and still rejects tomorrow and invalid dates", () => {
  const now = new Date("2026-11-24T15:00:10Z");
  const row = { from: "2026-11-24", to: "2026-11-25", impressions: 0, clicks: 0, purchases: 0,
    refundedOrders: 0, spend: 0, otherCosts: 0, revenue: 0, refunds: 0, starts: 0, completions: 0, cohortConfirmed: false };
  assert.equal(measurementIssue(row, now), "");
  assert.ok(measurementIssue({ ...row, to: "2026-11-26" }, now));
  assert.ok(measurementIssue({ ...row, from: "2026-02-30" }, now));
});

test("reopening the export form restores the last edited measured period beside legacy entries", () => {
  const revised = { from: "2026-01-01", to: "2026-01-07" };
  const older = { from: "2026-01-08", to: "2026-01-14" };
  assert.equal(latestAdMeasurement([
    { at: "2026-01-19T01:00:00Z", measurement: revised },
    { at: "2026-01-17T02:00:00Z", measurement: older },
    { at: "2026-01-20T02:00:00Z" },
  ]), revised);
  assert.equal(latestAdMeasurement([]), undefined);
});
