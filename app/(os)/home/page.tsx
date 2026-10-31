import { findPage } from "@/lib/navigation";
import { PersonalWorkHome } from "@/components/personal-work-home";
import { youtubeV1Mode } from "@/lib/youtube-process/gate";

export const metadata = { title: `${findPage("/home").label} | 브랜디 OS` };

export default function HomePage() {
  return <PersonalWorkHome youtubeV1Mode={youtubeV1Mode()} />;
}
