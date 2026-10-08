import { notFound } from "next/navigation";
import type { Metadata } from "next";

const names: Record<string, string> = {
  overview: "개요",
  sales: "매출내역",
  settlements: "정산입금",
  bank: "통장 내역",
  cards: "카드지출",
  recurring: "정기 결제",
  budget: "예산 관리",
};
type Props = { params: Promise<{ page: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await params;
  return { title: `${names[page] ?? "재무관리"} | 브랜디 OS` };
}

export default async function FinancePage({ params }: Props) {
  if (!Object.hasOwn(names, (await params).page)) notFound();
  return null;
}
