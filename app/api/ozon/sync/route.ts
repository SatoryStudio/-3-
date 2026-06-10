import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { OzonSyncService } from "@/lib/integrations/ozon-sync-service";
import { integrationSettingsService, storage } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const action = String(body.action) as "test" | "orders" | "statuses" | "finance";
    if (!["test", "orders", "statuses", "finance"].includes(action)) throw new Error("Неизвестный тип синхронизации");
    const days = Math.min(90, Math.max(1, Number(body.period || 30)));
    const to = body.to ? new Date(body.to) : new Date();
    const from = body.from ? new Date(body.from) : new Date(to.getTime() - days * 86400000);
    const result = await new OzonSyncService(storage, integrationSettingsService)
      .run(action, { from: from.toISOString(), to: to.toISOString() });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
