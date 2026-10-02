import { findPage } from "@/lib/navigation";
import { Dashboard } from "@/components/dashboard";

export const metadata = { title: `${findPage("/home").label} | 브랜디 OS` };

export default function HomePage() {
  return <Dashboard />;
}
