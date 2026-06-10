import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { inventoryService } from "@/lib/services/inventory-service";
import { storage } from "@/lib/storage";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await context.params;
    await storage.transaction((unit) => inventoryService.cancelOrder(unit, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
