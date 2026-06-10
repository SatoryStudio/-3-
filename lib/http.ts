import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  const status = message === "UNAUTHORIZED" ? 401 : 400;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
  return NextResponse.json({ ok: false, error: status === 401 ? "Требуется вход" : message, code }, { status });
}
