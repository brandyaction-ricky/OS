import { FinanceWorkspace } from "@/components/finance/finance-workspace";

export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <FinanceWorkspace />
    </>
  );
}
