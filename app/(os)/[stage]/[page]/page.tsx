import { PlaceholderPage } from "@/components/placeholder-page";
import { NAV_STAGES } from "@/lib/navigation";

export default async function GenericPage({ params }: { params: Promise<{ stage: string; page: string }> }) {
  const resolved = await params;
  const href = `/${resolved.stage}/${resolved.page}`;
  const stage = NAV_STAGES.find((item) => item.pages.some((page) => page.href === href));
  const page = stage?.pages.find((item) => item.href === href);
  return <PlaceholderPage title={page?.label ?? "기능 준비"} stage={stage?.label ?? "OS"} />;
}
