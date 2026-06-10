import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { ProductCatalogWorkbookService } from "@/lib/services/product-catalog-workbook-service";
import { storage } from "@/lib/storage";

export async function POST() {
  try {
    await requireSession();
    const changed = await new ProductCatalogWorkbookService(storage).syncIfChanged(true);
    return NextResponse.json({ ok: true, changed });
  } catch (error) {
    return apiError(error);
  }
}
