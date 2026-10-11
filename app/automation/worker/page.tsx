import { Suspense } from "react";
import { SessionProvider } from "@/components/session-provider";
import { ContentAutomationWorkerScreen } from "@/components/content-automation-worker-screen";

export default function WorkerPage(){
  return <SessionProvider><Suspense fallback={<main className="ca-worker"><p>AI 작업 화면을 여는 중입니다…</p></main>}><ContentAutomationWorkerScreen /></Suspense></SessionProvider>;
}
