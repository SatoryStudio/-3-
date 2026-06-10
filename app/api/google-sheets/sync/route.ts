import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { googleSheetsService } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    await requireSession();
    const type = String((await request.json()).type || "all");
    if (!["products", "filament", "all"].includes(type)) throw new Error("Неизвестный тип синхронизации");
    const products = type === "filament" ? undefined : await googleSheetsService.sync("products");
    const filament = type === "products" ? undefined : await googleSheetsService.sync("filament");
    return NextResponse.json({ ok: true, products, filament });
  } catch (error) {
    return apiError(error);
  }
}
