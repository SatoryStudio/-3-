import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import type { IncomingOrder } from "@/lib/domain/types";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { storage } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    await requireSession();
    const input = await request.json() as IncomingOrder;
    const result = await storage.transaction((unit) => orderIngestionService.ingest(unit, {
      ...input,
      marketplace: "manual",
      marketplace_order_id: input.marketplace_order_id || `MANUAL-${Date.now()}`,
      order_date: input.order_date || new Date().toISOString(),
    }));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return apiError(error);
  }
}
