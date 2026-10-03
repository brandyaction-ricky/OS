import { findPage } from "@/lib/navigation";
import { ReviewInbox } from "@/components/review-inbox";

export const metadata = { title: `${findPage("/knowledge/review").label} | 브랜디 OS` };

export default function ReviewPage() { return <ReviewInbox />; }
