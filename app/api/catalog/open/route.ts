import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { ProductCatalogWorkbookService } from "@/lib/services/product-catalog-workbook-service";
import { storage } from "@/lib/storage";

const execFileAsync = promisify(execFile);

export async function POST() {
  try {
    await requireSession();
    const catalog = new ProductCatalogWorkbookService(storage);
    await catalog.ensure();
    if (process.platform !== "darwin") throw new Error("Автоматическое открытие сейчас поддерживается только на macOS");
    await execFileAsync("open", [catalog.filePath]);
    return NextResponse.json({ ok: true, message: "Таблица товаров открыта" });
  } catch (error) {
    return apiError(error);
  }
}
