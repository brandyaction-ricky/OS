import { resolveMeetingBusiness } from "../meeting-business.ts";

export const TEAM_BUSINESSES = [
  { key: "myin", label: "마이인", brand: "마이인" },
  { key: "edu", label: "브랜디에듀", brand: "브랜디액션 에듀" },
  { key: "company", label: "회사 전체", brand: "브랜디액션" },
] as const;

export function teamBusiness(value: string) {
  const normalized = resolveMeetingBusiness(value)?.recordBrand;
  return TEAM_BUSINESSES.find(business => business.brand === normalized) ?? null;
}

export function teamBrand(value: string) {
  return TEAM_BUSINESSES.find(business => business.key === value)?.brand ?? teamBusiness(value)?.brand ?? null;
}
