import { redirect } from "next/navigation";

export default function LegacyContentsPage() {
  redirect("/content/topics");
}
