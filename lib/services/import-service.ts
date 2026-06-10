import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import type { FilamentSpool, MarketplaceCode, Product } from "@/lib/domain/types";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import { normalizeMarketplaceSku } from "@/lib/services/sku-normalization";

function text(value: unknown) { return String(value ?? "").trim(); }
function number(value: unknown, field: string, row: number) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Строка ${row}: некорректное поле ${field}`);
  return Math.round(parsed * 100) / 100;
}

async function readRows(buffer: Buffer) {
  if (buffer.subarray(0, 2).toString() !== "PK") {
    return parse(buffer.toString("utf8"), {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    }) as Record<string, unknown>[];
  }
  const sheet = await readXlsxFile(buffer);
  let headerRowNumber = 0;
  for (let index = 0; index < Math.min(sheet.length, 20); index++) {
    const values = sheet[index].map(text);
    if (values.includes("marketplace_sku") || values.includes("spool_weight_grams")) {
      headerRowNumber = index;
      break;
    }
  }
  if (!sheet[headerRowNumber]?.some((value) => ["marketplace_sku", "spool_weight_grams"].includes(text(value)))) {
    throw new Error("Не найдена строка заголовков импорта");
  }
  const headers = sheet[headerRowNumber];
  const rows: Record<string, unknown>[] = [];
  sheet.slice(headerRowNumber + 1).forEach((row) => {
    const object: Record<string, unknown> = {};
    headers.forEach((header, columnIndex) => {
      object[text(header)] = row[columnIndex];
    });
    if (Object.values(object).some((value) => text(value))) rows.push(object);
  });
  return rows;
}

export class ImportService {
  constructor(private readonly storage: StorageAdapter) {}

  async importProducts(buffer: Buffer) {
    const rows = await readRows(buffer);
    const required = ["marketplace", "marketplace_sku", "name", "filament_material", "filament_color", "weight_grams"];
    rows.forEach((row, index) => required.forEach((field) => {
      if (!text(row[field])) throw new Error(`Строка ${index + 2}: отсутствует ${field}`);
    }));
    return this.storage.transaction((unit) => {
      let created = 0;
      let updated = 0;
      const now = new Date().toISOString();
      rows.forEach((row, index) => {
        const marketplace = text(row.marketplace).toLowerCase() as MarketplaceCode;
        if (!["manual", "yandex", "ozon"].includes(marketplace)) throw new Error(`Строка ${index + 2}: неизвестный marketplace`);
        const sku = text(row.marketplace_sku);
        const normalizedSku = normalizeMarketplaceSku(sku);
        const existing = unit.data.products.find((product) => product.marketplace === marketplace && normalizeMarketplaceSku(product.marketplace_sku) === normalizedSku);
        const values = {
          marketplace, marketplace_sku: sku, name: text(row.name), filament_material: text(row.filament_material),
          filament_color: text(row.filament_color), weight_grams: Math.round(number(row.weight_grams, "weight_grams", index + 2)),
          print_time_minutes: Math.round(number(row.print_time_minutes || 0, "print_time_minutes", index + 2)),
          packaging_cost: Math.round(number(row.packaging_cost || 0, "packaging_cost", index + 2) * 100),
          extra_cost: Math.round(number(row.extra_cost || 0, "extra_cost", index + 2) * 100), is_active: true, updated_at: now,
        };
        if (existing) { Object.assign(existing, values); updated++; }
        else { unit.data.products.push({ id: crypto.randomUUID(), created_at: now, ...values } as Product); created++; }
      });
      unit.touch("products");
      return { created, updated, rejected: 0 };
    });
  }

  async importSpools(buffer: Buffer) {
    const rows = await readRows(buffer);
    const required = ["material", "color", "spool_weight_grams", "remaining_weight_grams", "price_per_spool"];
    rows.forEach((row, index) => required.forEach((field) => {
      if (text(row[field]) === "") throw new Error(`Строка ${index + 2}: отсутствует ${field}`);
    }));
    return this.storage.transaction((unit) => {
      const now = new Date().toISOString();
      rows.forEach((row, index) => {
        const initial = Math.round(number(row.spool_weight_grams, "spool_weight_grams", index + 2));
        const remaining = Math.round(number(row.remaining_weight_grams, "remaining_weight_grams", index + 2));
        const pricePerSpool = Math.round(number(row.price_per_spool, "price_per_spool", index + 2) * 100);
        if (remaining > initial || initial <= 0) throw new Error(`Строка ${index + 2}: некорректный вес катушки`);
        const pricePerKg = text(row.price_per_kg)
          ? Math.round(number(row.price_per_kg, "price_per_kg", index + 2) * 100)
          : Math.round((pricePerSpool / initial) * 1000);
        const spool: FilamentSpool = {
          id: crypto.randomUUID(), material: text(row.material), color: text(row.color), brand: text(row.brand),
          supplier: text(row.supplier || row.brand), location: text(row.location),
          initial_weight_grams: initial, remaining_weight_grams: remaining, reserved_weight_grams: 0,
          price_per_spool: pricePerSpool, price_per_kg: pricePerKg, purchase_date: text(row.purchase_date) || now.slice(0, 10),
          google_spreadsheet_id: "", google_sheet_gid: 0, google_row_number: 0, google_row_fingerprint: "",
          status: remaining ? "active" : "empty", created_at: now, updated_at: now,
        };
        unit.data.filament_spools.push(spool);
        unit.data.filament_movements.push({
          id: crypto.randomUUID(), spool_id: spool.id, order_id: "", order_item_id: "", print_job_id: "",
          type: "purchase", grams: initial, comment: "Импорт катушки", created_at: now,
        });
      });
      unit.touch("filament_spools", "filament_movements");
      return { created: rows.length, updated: 0, rejected: 0 };
    });
  }
}
