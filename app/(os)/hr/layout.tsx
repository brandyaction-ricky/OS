import { notFound } from "next/navigation";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { HrProvider } from "@/components/hr/context";
import "@/components/hr/hr.css";
export const dynamic="force-dynamic";
export default function HrLayout({children}:{children:React.ReactNode}){if(!hrWorkspaceEnabled())notFound();return <HrProvider>{children}</HrProvider>;}
