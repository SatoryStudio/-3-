import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { ProductCatalogWorkbookService } from "@/lib/services/product-catalog-workbook-service";
import { ExcelStorageAdapter } from "@/lib/storage/excel-storage-adapter";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))));

describe("ProductCatalogWorkbookService", () => {
  it("creates a persistent catalog and syncs saved rows into product storage", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "filament-catalog-"));
    dirs.push(dir);
    const adapter = new ExcelStorageAdapter(dir);
    const catalog = new ProductCatalogWorkbookService(adapter, dir);
    await catalog.ensure();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(catalog.filePath);
    workbook.getWorksheet("Товары")!.addRow(["ozon", "OZ-100", "Органайзер", "PLA", "black", 150, 180, 35, 5]);
    await workbook.xlsx.writeFile(catalog.filePath);

    expect(await catalog.syncIfChanged(true)).toBe(true);
    const products = (await adapter.read()).products;
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      marketplace: "ozon",
      marketplace_sku: "OZ-100",
      packaging_cost: 3500,
    });
  });
});
