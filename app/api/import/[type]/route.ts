import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { ImportService } from "@/lib/services/import-service";
import { storage } from "@/lib/storage";

export async function POST(request: Request, context: { params: Promise<{ type: string }> }) {
  try {
    await requireSession();
    const { type } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Выберите файл");
    if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error("Поддерживаются только XLSX и CSV");
    const service = new ImportService(storage);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = type === "products"
      ? await service.importProducts(buffer)
      : type === "spools"
        ? await service.importSpools(buffer)
        : (() => { throw new Error("Неизвестный тип импорта"); })();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return apiError(error);
  }
}
