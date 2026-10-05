
import {YoutubeConnectionPanel} from "./youtube-connection-panel";
import { PageTitle } from "./page-title";
import Link from "next/link";
import { ConnectionEvidence } from "./connection-evidence";
import { MonitoringWorkspace } from "./monitoring-workspace";
import { SettingsWorkspace } from "./settings-workspaces";
export function SystemStatusWorkspace({ tab = "connections" }: { tab?: "connections" | "monitoring" | "channels" }) {
  return <><header className="page-header"><div className="page-title-group"><PageTitle /><p>연결 확인 근거, 막힌 작업, 메시지 창구와 담당자를 함께 확인합니다.</p></div></header>
    <nav className="system-status-tabs" aria-label="작동 상태 탭">{([['connections', '연결 상태'], ['monitoring', '작업 모니터링'], ['channels', '메시지 창구']] as const).map(([key, label]) => <Link key={key} className={tab === key ? "primary-button" : "secondary-button"} href={`/settings/${key}`} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}</nav>
    {tab === "connections" ? <div className="system-status-stack"><ConnectionEvidence /><YoutubeConnectionPanel/><details className="panel system-status-details"><summary>서비스 설정과 개인 채널 동의 상태</summary><div className="system-status-details-body"><SettingsWorkspace page="connections" embedded /></div></details></div> : tab === "monitoring" ? <MonitoringWorkspace embedded /> : <SettingsWorkspace page="channels" embedded />}
  </>;
}
