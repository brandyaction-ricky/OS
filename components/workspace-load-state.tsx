import type { ReactNode } from "react";

export function WorkspaceSkeleton() {
  return <section className="workspace-skeleton" role="status" aria-label="데이터 불러오는 중" aria-busy="true">
    <span className="sr-only">데이터를 불러오는 중입니다.</span>
    <div className="metric-grid compact-metrics" aria-hidden="true">{[0, 1, 2, 3].map(key => <div className="metric-card" key={key}><i /><i /><i /></div>)}</div>
    <div className="panel" aria-hidden="true">{[0, 1, 2, 3].map(key => <i key={key} />)}</div>
  </section>;
}
export function WorkspaceLoadState({ loading, error, retry, children }: { loading: boolean; error?: string; retry?: () => void; children: ReactNode }) {
  if (loading) return <WorkspaceSkeleton />;
  if (error) return <div className="panel load-error" role="alert"><p>{error}</p>{retry ? <button className="secondary-button" onClick={retry}>다시 불러오기</button> : null}</div>;
  return <>{children}</>;
}
