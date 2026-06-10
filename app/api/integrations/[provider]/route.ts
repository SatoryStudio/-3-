import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import type { IntegrationProvider } from "@/lib/services/integration-settings-service";
import { integrationSettingsService } from "@/lib/storage";

function provider(value: string): IntegrationProvider {
  if (value === "yandex" || value === "yandex_market") return "yandex_market";
  if (value === "ozon") return "ozon";
  if (value === "google" || value === "google_sheets") return "google_sheets";
  throw new Error("Неизвестная интеграция");
}

export async function GET(_: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    await requireSession();
    return NextResponse.json(
      await integrationSettingsService.getProviderSettingsStatus(provider((await context.params).provider)),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    await requireSession();
    const result = await integrationSettingsService.saveProviderSettings(
      provider((await context.params).provider),
      await request.json(),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    await requireSession();
    await integrationSettingsService.deleteProviderSettings(provider((await context.params).provider));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
