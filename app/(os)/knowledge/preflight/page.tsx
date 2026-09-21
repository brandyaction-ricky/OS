import { notFound } from "next/navigation";
import { canUseSystemOnePreflight } from "@/lib/system-one-preflight-gate";
import { SystemOnePreflightCheck } from "@/components/system-one-preflight-check";

export const dynamic = "force-dynamic";

// Technical QA entry only. No navigation item, production access, or write API.
export default function PreflightCheckPage() {
  if (!canUseSystemOnePreflight(process.env)) notFound();
  return <SystemOnePreflightCheck />;
}
