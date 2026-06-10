import type { Database, FilamentSpool, Product } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/storage/schema";

export function emptyDatabase(): Database {
  return {
    users: [],
    products: [],
    filament_spools: [],
    orders: [],
    order_items: [],
    filament_movements: [],
    print_jobs: [],
    printers: [],
    financial_operations: [],
    sync_logs: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    integration_settings: [],
    marketing_expenses: [],
  };
}

export function product(overrides: Partial<Product> = {}): Product {
  return {
    id: crypto.randomUUID(), marketplace: "manual", marketplace_sku: "SKU-1", name: "Товар",
    filament_material: "PLA", filament_color: "black", weight_grams: 100, print_time_minutes: 60,
    packaging_cost: 0, extra_cost: 0, is_active: true, created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

export function spool(overrides: Partial<FilamentSpool> = {}): FilamentSpool {
  return {
    id: crypto.randomUUID(), material: "PLA", color: "black", brand: "Test", supplier: "", location: "",
    initial_weight_grams: 1000,
    remaining_weight_grams: 1000, reserved_weight_grams: 0, price_per_spool: 120000, price_per_kg: 120000,
    google_spreadsheet_id: "", google_sheet_gid: 0, google_row_number: 0, google_row_fingerprint: "",
    purchase_date: "2026-01-01", status: "active", created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

export function unit(data: Database) {
  const touched = new Set<string>();
  return { data, touch: (...tables: any[]) => tables.forEach((table) => touched.add(table)), touched };
}
