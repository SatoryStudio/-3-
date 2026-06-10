import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { inventoryService } from "@/lib/services/inventory-service";
import { storage } from "@/lib/storage";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await context.params;
    const body = await request.json();
    await storage.transaction((unit) => {
      if (body.action === "start") inventoryService.markPrinting(unit, id, String(body.printer_id || ""));
      else if (body.action === "success") inventoryService.completePrint(
        unit,
        id,
        Number(body.grams || 0) || undefined,
        body.usage_source === "printer" || body.usage_source === "history" ? body.usage_source : "manual",
      );
      else if (body.action === "fail") inventoryService.failPrint(unit, id, Number(body.grams));
      else throw new Error("Неизвестное действие");
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
