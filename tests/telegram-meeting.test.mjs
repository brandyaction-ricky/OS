import assert from "node:assert/strict";
import test from "node:test";
import {
  isMeetingPrepCommand,
  isMeetingRecordCommand,
  parseMeetingPrepBrand,
  parseMeetingRecordCommand,
} from "../lib/telegram-meeting.ts";
import { resolveMeetingBusiness } from "../lib/meeting-business.ts";

test("meeting business aliases resolve to the exact os_records.brand and knowledge-folder labels", () => {
  assert.deepEqual(resolveMeetingBusiness("마이인"), { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" });
  assert.deepEqual(resolveMeetingBusiness("myin"), { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" });
  assert.deepEqual(resolveMeetingBusiness("교육"), { recordBrand: "브랜디액션 에듀", wikiFolderSegment: "브랜디에듀", label: "자영업 교육" });
  assert.deepEqual(resolveMeetingBusiness("브랜디에듀"), { recordBrand: "브랜디액션 에듀", wikiFolderSegment: "브랜디에듀", label: "자영업 교육" });
  assert.equal(resolveMeetingBusiness("모르는사업"), null);
});

test("/회의준비 parses an optional brand and defaults to all brands", () => {
  assert.equal(isMeetingPrepCommand("/회의준비 마이인"), true);
  assert.equal(isMeetingPrepCommand("회의준비"), true);
  assert.equal(isMeetingPrepCommand("/회의준비보고서"), false);
  assert.equal(parseMeetingPrepBrand("/회의준비 마이인"), "마이인");
  assert.equal(parseMeetingPrepBrand("/회의준비 교육"), "브랜디액션 에듀");
  assert.equal(parseMeetingPrepBrand("/회의준비"), "");
  assert.equal(parseMeetingPrepBrand("/회의준비 모르는사업"), "");
});

test("/회의기록 requires a recognized business before it will parse content", () => {
  assert.equal(isMeetingRecordCommand("/회의기록 마이인 오늘 결정된 것"), true);
  assert.equal(isMeetingRecordCommand("회의기록추가내용"), false);
  const parsed = parseMeetingRecordCommand("/회의기록 마이인 광고 예산을 20만원으로 유지하기로 했다.");
  assert.deepEqual(parsed, { business: { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" }, content: "광고 예산을 20만원으로 유지하기로 했다." });
  assert.equal(parseMeetingRecordCommand("/회의기록 모르는사업 아무 내용"), null);
  assert.equal(parseMeetingRecordCommand("/회의기록"), null);
});
