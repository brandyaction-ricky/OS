import { pathToFileURL } from "node:url";

export async function retryIndexing({ base, token, execute = false, confirmOrigin, limit = 25, fetchImpl = fetch }) {
  const target = new URL(base);
  if (target.username || target.password || target.search || target.hash || target.pathname !== "/") throw new Error("대상은 경로·계정 정보가 없는 원점 URL이어야 합니다.");
  if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) throw new Error("HTTPS 또는 로컬 개발 서버만 사용할 수 있습니다.");
  if (!token) throw new Error("OS_ADMIN_TOKEN 환경변수에 관리자 세션 토큰이 필요합니다.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("limit은 1~500 정수여야 합니다.");
  if (execute && confirmOrigin !== target.origin) throw new Error("실행하려면 --confirm-origin에 승인된 대상 원점을 정확히 지정하세요.");
  const call = async (method, body) => {
    const response = await fetchImpl(new URL("/api/v1/indexing", target), {
      method, redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`색인 API 요청 실패 (HTTP ${response.status}). 대상과 관리자 권한을 확인하세요.`);
    return response.json();
  };
  const snapshot = await call("GET");
  const coverage = snapshot?.queue?.coverage;
  if (!coverage || coverage.truncated || !Number.isInteger(coverage.failed) || coverage.failed < 0) throw new Error("현재 문서 집계를 완전히 확인하지 못했습니다. 재시도는 실행하지 않았습니다.");
  const report = { mode: execute ? "execute" : "dry-run", currentFailed: coverage.failed, limit, retried: 0 };
  if (!execute || !coverage.failed) return report;
  // Enqueue only. Provider calls require a separate, approved processing action.
  const result = await call("POST", { action: "retry_failed", limit });
  if (!Number.isInteger(result.retried) || result.retried < 0) throw new Error("재시도 응답을 확인하지 못했습니다. 반복 실행 전에 관리자 화면에서 현황을 확인하세요.");
  return { ...report, retried: result.retried };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  if (args.includes("--help")) {
    console.log("OS_ADMIN_TOKEN=관리자세션 node tools/retry-indexing.mjs --base https://승인된대상 [--limit 25] [--execute --confirm-origin https://승인된대상]\n기본값은 조회 전용입니다. 실행은 해당 환경의 승인 후에만 사용하세요. 토큰을 명령 인자나 기록에 넣지 마세요.");
  } else {
    try {
      if (!args.includes("--base")) throw new Error("--base 대상 URL이 필요합니다.");
      console.log(JSON.stringify(await retryIndexing({ base: value("--base"), token: process.env.OS_ADMIN_TOKEN, execute: args.includes("--execute"), confirmOrigin: args.includes("--confirm-origin") ? value("--confirm-origin") : undefined, limit: args.includes("--limit") ? Number(value("--limit")) : 25 })));
    } catch (error) {
      // Only known validation messages are exposed. Fetch/JSON bodies may contain private details.
      console.error(error instanceof Error && /^(대상은|HTTPS|OS_ADMIN_TOKEN|limit은|실행하려면|색인 API|현재 문서|재시도 응답|--base)/.test(error.message) ? error.message : "대상에 연결하지 못했습니다. 네트워크와 설정을 확인하세요.");
      process.exitCode = 1;
    }
  }
}
