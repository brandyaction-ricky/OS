import { findPage } from "@/lib/navigation";
import { PersonalWorkHome } from "@/components/personal-work-home";

export const metadata = { title: `${findPage("/home").label} | 브랜디 OS` };

export default function HomePage() {
  return <PersonalWorkHome />;
}
