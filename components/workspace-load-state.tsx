import type { ReactNode } from "react";

export function WorkspaceSkeleton() {
  return <section className="workspace-skeleton" role="status" aria-label="데이터 불러오는 중" aria-busy="true">
    <span className="sr-only">데이터를 불러오는 중입니다.</span>
    <div className="metric-grid compact-metrics" aria-hidden="true">{[0, 1, 2, 3].map(key => <div className="metric-card" key={key}><i /><div className="metric-value"><NumberLoading /></div><i /></div>)}</div>
    <div className="panel" aria-hidden="true">{[0, 1, 2, 3].map(key => <i key={key} />)}</div>
  </section>;
}
export function WorkspaceLoadState({ loading, error, retry, children }: { loading: boolean; error?: string; retry?: () => void; children: ReactNode }) {
  if (loading) return <WorkspaceSkeleton />;
  if (error) return <div className="panel load-error" role="alert"><p>{error}</p>{retry ? <button className="secondary-button" onClick={retry}>다시 불러오기</button> : null}</div>;
  return <>{children}</>;
}

/** While a figure is loading: grey digits rolling in place, plainly not a real number. */
export function NumberLoading({ digits = 4 }: { digits?: number }) {
  return <span className="number-loading" role="status"><span className="sr-only">숫자를 불러오는 중</span>
    {Array.from({ length: digits }, (_, i) => <span key={i} className="number-loading-digit" aria-hidden="true">
      <span style={{ animationDelay: `${-i * 0.37}s`, animationDuration: `${0.9 + i * 0.23}s` }}>0<br />1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9<br />0</span></span>)}</span>;
}
