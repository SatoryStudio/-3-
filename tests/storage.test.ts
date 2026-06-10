import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { ExcelStorageAdapter } from "@/lib/storage/excel-storage-adapter";
import { ImportService } from "@/lib/services/import-service";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))));

describe("ExcelStorageAdapter", () => {
  it("initializes every workbook and persists a transaction with backup", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filament-storage-"));
    dirs.push(dir);
    const adapter = new ExcelStorageAdapter(dir);
    await adapter.initialize();
    await adapter.transaction((unit) => {
      unit.data.marketing_expenses.push({
        id: crypto.randomUUID(), date: "2026-06-06", amount: 10000, source: "other",
        comment: "Тест", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      unit.touch("marketing_expenses");
    });
    const database = await adapter.read();
    expect(database.marketing_expenses).toHaveLength(1);
    const backups = await fs.readdir(path.join(dir, "backups"));
    expect(backups.length).toBeGreaterThan(0);
    expect(await fs.readdir(path.join(dir, "transactions"))).toHaveLength(0);
  });

  it("serializes concurrent writers through one lock", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filament-lock-"));
    dirs.push(dir);
    const adapter = new ExcelStorageAdapter(dir);
    await adapter.initialize();
    await Promise.all(Array.from({ length: 4 }, (_, index) => adapter.transaction(async (unit) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      unit.data.marketing_expenses.push({
        id: String(index), date: "2026-06-06", amount: index, source: "other", comment: "",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      unit.touch("marketing_expenses");
    })));
    expect((await adapter.read()).marketing_expenses).toHaveLength(4);
  });

  it("imports the styled XLSX templates with headers below the title", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filament-import-"));
    dirs.push(dir);
    const adapter = new ExcelStorageAdapter(dir);
    const service = new ImportService(adapter);
    const root = process.cwd();
    await service.importProducts(await fs.readFile(path.join(root, "public/templates/products-template.xlsx")));
    await service.importSpools(await fs.readFile(path.join(root, "public/templates/filament-template.xlsx")));
    const database = await adapter.read();
    expect(database.products).toHaveLength(2);
    expect(database.filament_spools).toHaveLength(2);
    expect(database.filament_spools[0].price_per_kg).toBe(120000);
  });

  it("imports CSV files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filament-csv-"));
    dirs.push(dir);
    const adapter = new ExcelStorageAdapter(dir);
    const service = new ImportService(adapter);
    const csv = "marketplace,marketplace_sku,name,filament_material,filament_color,weight_grams,print_time_minutes,packaging_cost,extra_cost\nmanual,CSV-1,Клипса,PLA,black,10,20,5,0\n";
    await service.importProducts(Buffer.from(csv));
    expect((await adapter.read()).products[0].marketplace_sku).toBe("CSV-1");
  });

  it("migrates legacy data to schema v7", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filament-migration-"));
    dirs.push(dir);
    await new ExcelStorageAdapter(dir).initialize();

    const orders = new ExcelJS.Workbook();
    const orderSheet = orders.addWorksheet("Data");
    orderSheet.addRow([
      "id", "marketplace", "marketplace_order_id", "marketplace_status", "internal_status", "order_date",
      "shipment_date", "historical", "gross_revenue", "expected_payout", "actual_payout", "marketplace_cost",
      "production_cost", "profit", "margin_percent", "calculation_state", "raw_payload", "created_at", "updated_at",
    ]);
    orderSheet.addRow([
      "legacy-order", "yandex", "100", "PROCESSING", "problem", "2026-06-01T00:00:00.000Z",
      "", false, 0, 0, 0, 0, 0, 0, 0, "estimated", "", "2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z",
    ]);
    orders.addWorksheet("Meta").addRows([["table", "orders"], ["schema_version", 3]]);
    await orders.xlsx.writeFile(path.join(dir, "orders.xlsx"));

    const logs = new ExcelJS.Workbook();
    const logSheet = logs.addWorksheet("Data");
    logSheet.addRow([
      "id", "source", "operation", "status", "period_from", "period_to", "message", "safe_error_code",
      "started_at", "finished_at", "created_at",
    ]);
    logSheet.addRow([
      "legacy-log", "yandex", "sync_orders", "error", "", "", "Старая безопасная ошибка", "api_error",
      "2026-06-01T00:00:00.000Z", "2026-06-01T00:01:00.000Z", "2026-06-01T00:00:00.000Z",
    ]);
    logs.addWorksheet("Meta").addRows([["table", "sync_logs"], ["schema_version", 3]]);
    await logs.xlsx.writeFile(path.join(dir, "sync_logs.xlsx"));

    const migrated = new ExcelStorageAdapter(dir);
    const database = await migrated.read();
    expect(database.orders[0]).toMatchObject({
      id: "legacy-order", problem_code: "", problem_message: "",
      marketplace_substatus: "", delivery_date: "", profit_status: "complete",
    });
    expect(database.sync_logs[0]).toMatchObject({
      id: "legacy-log",
      entry_type: "error",
      error_code: "api_error",
      safe_message: "Старая безопасная ошибка",
    });
    expect(database.filament_spools.every((spool) =>
      spool.supplier === "" && spool.location === ""
      && spool.google_spreadsheet_id === ""
      && spool.google_sheet_gid === 0
      && spool.google_row_number === 0)).toBe(true);
    const backups = await fs.readdir(path.join(dir, "backups"));
    expect(backups.some((name) => name.startsWith("schema-"))).toBe(true);
  });
});
