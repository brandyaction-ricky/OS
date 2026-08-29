import { NextResponse } from "next/server";
import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
  return match[1];
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
  console.error(error);
  return NextResponse.json<ApiErrorBody>(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 },
  );
}

export async function parseJson(request: Request, maxBytes = 4_000_000) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new ApiError(413, "BODY_TOO_LARGE", "요청 본문이 너무 큽니다.");
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 형식을 확인해 주세요.");
  }
}
