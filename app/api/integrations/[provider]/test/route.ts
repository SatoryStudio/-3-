import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { OzonSyncService } from "@/lib/integrations/ozon-sync-service";
import { YandexSyncService } from "@/lib/integrations/yandex-sync-service";
import { integrationSettingsService, storage } from "@/lib/storage";

export async function POST(_: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    await requireSession();
    const { provider } = await context.params;
    const to = new Date();
    const period = { from: new Date(to.getTime() - 86_400_000).toISOString(), to: to.toISOString() };
    const service = provider === "yandex"
      ? new YandexSyncService(storage, integrationSettingsService)
      : provider === "ozon"
        ? new OzonSyncService(storage, integrationSettingsService)
        : null;
    if (!service) throw new Error("Неизвестная интеграция");
    const result = await service.run("test", period);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
