import { notFound } from "next/navigation";
import { SystemOneSandbox } from "@/components/system-one-sandbox";
import { canUseSystemOneMock } from "@/lib/system-one-local";

export const dynamic = "force-dynamic";

export default function SystemOnePage() {
  if (!canUseSystemOneMock(process.env)) notFound();
  return <SystemOneSandbox />;
}
