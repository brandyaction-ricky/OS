import { redirect } from "next/navigation";

export default async function AutomationDetailAlias({params}:{params:Promise<{page:string;id:string}>}){
  const {page,id}=await params;
  if(!["cardnews","shorts","threads"].includes(page)||!/^[0-9a-f-]{36}$/i.test(id))
    redirect("/automation/dashboard?missing=1");
  redirect(`/automation/${page}?sel=${encodeURIComponent(id)}`);
}
