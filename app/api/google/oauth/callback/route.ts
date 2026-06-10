import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGoogleOAuthRedirectUri } from "@/lib/services/google-sheets-service";
import { googleSheetsService } from "@/lib/storage";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

function oauthErrorPage(error: string, description = "") {
  let callbackUrl = "";
  try { callbackUrl = getGoogleOAuthRedirectUri(); }
  catch (reason) { callbackUrl = reason instanceof Error ? reason.message : "APP_URL настроен неверно"; }
  const safeError = escapeHtml(error || "unknown_error");
  const safeDescription = escapeHtml(description);
  const safeCallback = escapeHtml(callbackUrl);
  return new NextResponse(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Google OAuth error</title>
<style>body{font:16px system-ui;max-width:760px;margin:60px auto;padding:0 24px;color:#211}code{display:block;padding:14px;background:#f6eeee;border-radius:10px;overflow-wrap:anywhere}a{color:#a21d27}</style>
</head><body><h1>Google OAuth error</h1><p><strong>error:</strong> ${safeError}</p>
${safeDescription ? `<p>${safeDescription}</p>` : ""}
<p>Используемый callback:</p><code>${safeCallback}</code>
<p>Добавьте этот callback в Google Cloud Console:</p>
<p><strong>APIs &amp; Services → Credentials → OAuth Client → Authorized redirect URIs</strong></p>
<p>Адрес должен совпадать полностью: протокол, домен, порт, путь и отсутствие завершающего слэша.</p>
<p><a href="/?google=error">Вернуться в Filament ERP</a></p></body></html>`, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    await googleSheetsService.recordOAuthCallback(
      "error",
      oauthError,
      oauthError === "redirect_uri_mismatch"
        ? "Redirect URI не совпадает с настройкой Google Cloud"
        : "Google отклонил OAuth-подключение",
    );
    return oauthErrorPage(oauthError, url.searchParams.get("error_description") || "");
  }
  const cookieStore = await cookies();
  const expected = cookieStore.get("google_oauth_state")?.value;
  cookieStore.delete("google_oauth_state");
  if (!expected || url.searchParams.get("state") !== expected) {
    await googleSheetsService.recordOAuthCallback(
      "error", "invalid_state", "Состояние OAuth не совпало или истекло",
    );
    return oauthErrorPage("invalid_state", "Состояние OAuth не совпало или истекло. Начните подключение заново.");
  }
  try {
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Код Google OAuth отсутствует");
    await googleSheetsService.exchangeCode(code);
    await googleSheetsService.recordOAuthCallback("success");
    return NextResponse.redirect(new URL("/?google=connected", request.url));
  } catch (error) {
    await googleSheetsService.recordOAuthCallback(
      "error", "token_exchange_failed",
      error instanceof Error ? error.message : "Не удалось завершить подключение Google",
    );
    return oauthErrorPage(
      "token_exchange_failed",
      error instanceof Error ? error.message : "Не удалось завершить подключение Google.",
    );
  }
}
