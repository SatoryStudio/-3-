import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualPrinterAdapter } from "@/lib/printers/manual-printer-adapter";
import { inventoryService } from "@/lib/services/inventory-service";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { PrinterService } from "@/lib/services/printer-service";
import { SecretService } from "@/lib/services/secret-service";
import { ExcelStorageAdapter } from "@/lib/storage/excel-storage-adapter";
import { emptyDatabase, product, spool, unit } from "@/tests/helpers";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "filament-printers-"));
  directories.push(directory);
  return directory;
}

describe("Printer adapters and service", () => {
  it("supports a fully working manual adapter contract", async () => {
    const adapter = new ManualPrinterAdapter();
    await expect(adapter.testConnection()).resolves.toMatchObject({ ok: true, status: "manual" });
    await expect(adapter.getPrinterStatus()).resolves.toMatchObject({ state: "idle" });
    await expect(adapter.getCurrentPrintJob()).resolves.toBeNull();
    await expect(adapter.getFilamentUsage()).resolves.toBeNull();
    await expect(adapter.getPrintHistory()).resolves.toEqual([]);
  });

  it("encrypts access codes and exposes only a configured marker", async () => {
    vi.stubEnv("APP_SECRET_KEY", "printer-test-master-key");
    const directory = await temporaryDirectory();
    const storage = new ExcelStorageAdapter(directory);
    const service = new PrinterService(storage, new SecretService(directory));
    const printer = await service.save({
      name: "Bambu A1",
      type: "bambu_lab",
      host: "192.168.1.50",
      serial_number: "SERIAL-1",
      access_code: "access-secret-1234",
      is_active: true,
    });
    expect(printer.access_code_configured).toBe(true);
    expect(JSON.stringify(printer)).not.toContain("access-secret-1234");
    const database = await storage.read();
    expect(database.printers[0].access_code_encrypted).not.toContain("access-secret-1234");
  });
});

describe("Printer-aware inventory", () => {
  it("prevents concurrent jobs on one printer and records manual actual usage", () => {
    const data = emptyDatabase();
    data.products.push(product());
    data.filament_spools.push(spool());
    data.printers.push({
      id: "printer-1",
      name: "Manual 1",
      type: "manual",
      host: "",
      access_code_encrypted: "",
      serial_number: "",
      is_active: true,
      last_status: "manual",
      last_seen_at: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const work = unit(data);
    orderIngestionService.ingest(work, {
      marketplace: "manual",
      marketplace_order_id: "PRINTER-1",
      order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    orderIngestionService.ingest(work, {
      marketplace: "manual",
      marketplace_order_id: "PRINTER-2",
      order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    const [first, second] = data.print_jobs;
    inventoryService.markPrinting(work, first.id, "printer-1");
    expect(() => inventoryService.markPrinting(work, second.id, "printer-1")).toThrow("уже идёт печать");
    inventoryService.completePrint(work, first.id, 92, "manual");
    expect(first.actual_grams).toBe(92);
    expect(first.usage_source).toBe("manual");
    expect(data.order_items.find((item) => item.id === first.order_item_id)?.actual_filament_grams).toBe(92);
  });
});
