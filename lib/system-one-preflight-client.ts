export type PreflightSelection = {
  source: { id: string; expectedVersion: number };
  criteria: { id: string; expectedVersion: number }[];
};

const messages: Record<string, string> = {
  not_enabled: "이 환경에서는 검수가 꺼져 있습니다.",
  authentication_failed: "로그인을 다시 확인해 주세요.",
  invalid_input: "서로 다른 문서 ID와 올바른 버전을 입력해 주세요.",
  unavailable: "읽을 수 없는 문서가 있습니다. 문서가 없거나 접근 권한이 없을 수 있습니다.",
  invalid_metadata: "문서 메타데이터를 확인할 수 없습니다.",
  stale: "입력한 버전과 현재 문서 버전이 다릅니다. 최신 버전을 확인해 주세요.",
  read_failed: "문서를 읽지 못했습니다. 잠시 후 다시 확인해 주세요.",
};

export async function checkPreflight(token: string, selection: PreflightSelection, signal: AbortSignal, send: typeof fetch = fetch) {
  // Existing app session stays inside the browser and goes only to the same-origin API.
  const response = await send("/api/v1/system-one/preflight", {
    method: "POST", cache: "no-store", signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(selection),
  });
  const body = await response.json();
  if (response.ok && body?.status === "ready" && body.policyStatus === "unverified" &&
      body.executionAllowed === false && body.judgment === null) {
    return "읽기·버전 확인 완료 — 내용 판단이나 실행 승인은 하지 않았습니다.";
  }
  // Never render raw server errors, document bodies, or unexpected response fields.
  if (!response.ok && body?.status === "stopped" && Object.hasOwn(messages, body.code)) {
    return messages[body.code];
  }
  return "예상하지 못한 응답입니다. 검수 완료로 처리하지 않습니다.";
}
