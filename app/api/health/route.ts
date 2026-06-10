import { NextResponse } from "next/server";
import {
  integrationSettingsService,
  storageDiagnosticsService,
  tunnelService,
  workerService,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [storage, worker, tunnel, yandex, ozon] = await Promise.all([
      storageDiagnosticsService.diagnose(),
      workerService.status(),
      tunnelService.read(),
      integrationSettingsService.isConfigured("yandex_market"),
      integrationSettingsService.isConfigured("ozon"),
    ]);
    return NextResponse.json({
      status: storage.ok ? "ok" : "degraded",
      storage: storage.ok ? "ok" : "error",
      worker: worker.state,
      tunnel: tunnel.provider === "manual" && tunnel.publicUrl ? "configured" : "not_configured",
      yandex: yandex ? "configured" : "not_configured",
      ozon: ozon ? "configured" : "not_configured",
    });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
