import { z } from "zod";
import { validDate } from "@/lib/hr/domain";
const row = z.object({
  isHoliday: z.string(),
  locdate: z.union([z.string(), z.number()]),
  dateName: z.string().min(1).max(100),
});
/** Provider data is untrusted. Never use response text, URLs, or keys in logs. */
export function parseHolidayResponse(input: unknown, year: number) {
  const response = z
    .object({
      response: z.object({
        header: z.object({ resultCode: z.union([z.string(), z.number()]) }),
        body: z.object({
          totalCount: z.coerce.number().int().min(0).max(200),
          items: z
            .union([
              z.string(),
              z.object({ item: z.union([row, z.array(row)]) }),
            ])
            .optional(),
        }),
      }),
    })
    .parse(input).response;
  if (String(response.header.resultCode).padStart(2, "0") !== "00")
    throw new Error("HOLIDAY_PROVIDER_ERROR");
  const items =
      typeof response.body.items === "object" ? response.body.items.item : [],
    all = Array.isArray(items) ? items : [items];
  if (all.length !== response.body.totalCount)
    throw new Error("HOLIDAY_INCOMPLETE");
  const dates = new Map<string, string[]>();
  for (const item of all) {
    if (item.isHoliday !== "Y") continue;
    const raw = String(item.locdate),
      day = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    if (!validDate(day) || !day.startsWith(String(year)))
      throw new Error("HOLIDAY_INVALID_DATE");
    dates.set(day, [...new Set([...(dates.get(day) || []), item.dateName])]);
  }
  return [...dates].map(([day, names]) => ({
    day,
    name: names.join(" · ").slice(0, 40),
    kind: names.some((n) => n.includes("대체"))
      ? "substitute"
      : names.some((n) => n.includes("임시"))
        ? "temporary"
        : "national",
  }));
}
export async function fetchHolidayYear(year: number, key: string) {
  const url = new URL(
    "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo",
  );
  url.search = new URLSearchParams({
    serviceKey: key,
    solYear: String(year),
    numOfRows: "200",
    pageNo: "1",
    _type: "json",
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("HOLIDAY_PROVIDER_ERROR");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("HOLIDAY_PROVIDER_ERROR");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) {
      await reader.cancel();
      throw new Error("HOLIDAY_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  return parseHolidayResponse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
    year,
  );
}
