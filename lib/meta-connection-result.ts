/** OAuth diagnostics must never include URLs, authorization codes, tokens, account ids or provider messages. */
const STAGES = ["short_token", "long_token", "profile"] as const;
export type MetaOAuthStage = typeof STAGES[number];
const KNOWN_CODES = ["META_STATE_INVALID", "META_CODE_REQUIRED", "META_NOT_CONFIGURED", "META_CONNECTION_FAILED", "META_TOKEN_MISSING", "META_ACCOUNT_TYPE", "META_SCHEMA_REQUIRED", "META_CONNECTION_SAVE_FAILED", "CHANNEL_ALREADY_CONNECTED", "CHANNEL_REPLACEMENT_REQUIRED", "META_PROVIDER_DENIED", "META_MODE_NOT_LIVE"] as const;

export function metaConnectionFailure(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = KNOWN_CODES.find(code => code === value.code) ?? "META_INTERNAL_ERROR";
  const details = value.details && typeof value.details === "object" ? value.details as Record<string, unknown> : {};
  const stage = STAGES.find(stage => stage === details.stage);
  const number = (key: string) => typeof details[key] === "number" && Number.isSafeInteger(details[key]) && (details[key] as number) >= 0 ? details[key] as number : undefined;
  const result = code === "CHANNEL_ALREADY_CONNECTED" ? "already_connected"
    : code === "CHANNEL_REPLACEMENT_REQUIRED" ? "disconnect_first"
    : code === "META_STATE_INVALID" || code === "META_CODE_REQUIRED" ? "request_expired"
    : code === "META_PROVIDER_DENIED" ? "permission_not_granted"
    : code === "META_NOT_CONFIGURED" || code === "META_MODE_NOT_LIVE" ? "configuration_required"
    : code === "META_SCHEMA_REQUIRED" || code === "META_CONNECTION_SAVE_FAILED" ? "connection_save_failed"
    : code === "META_ACCOUNT_TYPE" ? "account_unavailable"
    : stage === "profile" ? "profile_check_failed"
    : stage ? "token_exchange_failed" : "connection_failed";
  return { result, diagnostic: { code, ...(stage ? { stage } : {}), httpStatus: number("httpStatus"), providerCode: number("providerCode"), providerSubcode: number("providerSubcode") } };
}

export function metaConnectionResultMessage(result: string) {
  const messages: Record<string, string> = {
    connected: "채널을 연결했습니다.",
    already_connected: "다른 OS 계정에 연결되어 있습니다. 그 계정에서 팀 공유를 켜 주세요.",
    disconnect_first: "기존 계정을 먼저 해제한 뒤 다른 계정을 연결해 주세요.",
    request_expired: "연결 요청이 만료되었거나 확인되지 않았습니다. 아래 연결 버튼에서 다시 시작해 주세요.",
    permission_not_granted: "Meta에서 연결 동의가 완료되지 않았습니다. 연결할 계정과 허용할 권한을 확인해 주세요.",
    configuration_required: "OS의 Meta 연결 설정을 확인해야 합니다. 관리자에게 알려 주세요.",
    token_exchange_failed: "Meta 동의 후 인증 정보를 받는 단계에서 실패했습니다. 관리자에게 알려 주세요. 테스터 문제로 확인된 것은 아닙니다.",
    profile_check_failed: "Meta 인증 후 계정 정보를 확인하지 못했습니다. 관리자에게 알려 주세요.",
    connection_save_failed: "OS에 계정 연결을 저장하지 못했습니다. 관리자에게 알려 주세요. 테스터 초대를 다시 받을 필요는 없습니다.",
    account_unavailable: "Meta에서 연결할 계정 정보를 확인하지 못했습니다. 계정 종류와 프로필을 확인해 주세요.",
    tester_or_permission_required: "연결을 완료하지 못했습니다. 이 안내만으로는 실패 원인을 알 수 없습니다. 관리자에게 확인을 요청해 주세요.",
  };
  return messages[result] ?? "계정 연결을 완료하지 못했습니다. 관리자에게 알려 주세요.";
}
