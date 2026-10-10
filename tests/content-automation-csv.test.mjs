import assert from "node:assert/strict";
import test from "node:test";
import { automationCsv,automationExportRange,formatKstCsvDate } from "../lib/content-automation-csv.ts";

test("export periods use Korean calendar boundaries across month and week changes",()=>{
  const sunday=new Date("2026-10-11T14:30:00Z"); // Sunday 23:30 KST
  assert.deepEqual(automationExportRange("week",sunday),{
    start:"2026-10-04T15:00:00.000Z",end:"2026-10-11T15:00:00.000Z",
  });
  assert.deepEqual(automationExportRange("last",sunday),{
    start:"2026-08-31T15:00:00.000Z",end:"2026-09-30T15:00:00.000Z",
  });
  assert.equal(formatKstCsvDate("2026-10-10T15:05:00.000Z"),"2026-10-11 00:05");
});

test("CSV quotes commas and lines, adds BOM, and neutralizes spreadsheet formulas",()=>{
  const csv=automationCsv(["제목","값"],[["=IMPORTXML(\"x\")","쉼표, 줄\n바꿈"],["+SUM(1,2)",null]]);
  assert.equal(csv,"\uFEFF\"제목\",\"값\"\r\n\"'=IMPORTXML(\"\"x\"\")\",\"쉼표, 줄\n바꿈\"\r\n\"'+SUM(1,2)\",\"\"\r\n");
});
