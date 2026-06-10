import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { ImportService } from "@/lib/services/import-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

const globalCatalog = globalThis as typeof globalThis & { productCatalogMtime?: number };

export class ProductCatalogWorkbookService {
  readonly filePath: string;

  constructor(private readonly storage: StorageAdapter, dataDirOverride?: string) {
    const dataDir = dataDirOverride || process.env.DATA_DIR || path.join(process.cwd(), "data");
    this.filePath = path.resolve(dataDir, "product_catalog.xlsx");
  }

  async ensure() {
    try {
      await fs.access(this.filePath);
      return;
    } catch {}

    const database = await this.storage.read();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Filament ERP";
    const sheet = workbook.addWorksheet("Товары", {
      views: [{ state: "frozen", ySplit: 4 }],
      properties: { defaultRowHeight: 19 },
    });
    sheet.mergeCells("A1:I1");
    sheet.getCell("A1").value = "Filament ERP · Постоянный каталог товаров";
    sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 18 };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171514" } };
    sheet.getCell("A1").alignment = { vertical: "middle" };
    sheet.getRow(1).height = 30;
    sheet.mergeCells("A2:I2");
    sheet.getCell("A2").value = "Редактируйте строки и сохраняйте файл. ERP автоматически перечитает изменения. Стоимости указываются в рублях.";
    sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6D6D9" } };
    sheet.getCell("A2").alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(2).height = 32;

    const columns = [
      "marketplace", "marketplace_sku", "name", "filament_material", "filament_color",
      "weight_grams", "print_time_minutes", "packaging_cost", "extra_cost",
    ];
    sheet.getRow(4).values = columns;
    sheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC9272D" } };
    sheet.getRow(4).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.getRow(4).height = 30;
    sheet.columns = [
      { width: 14 }, { width: 20 }, { width: 32 }, { width: 20 }, { width: 18 },
      { width: 16 }, { width: 20 }, { width: 18 }, { width: 16 },
    ];

    database.products.forEach((product) => {
      sheet.addRow([
        product.marketplace, product.marketplace_sku, product.name, product.filament_material,
        product.filament_color, product.weight_grams, product.print_time_minutes,
        product.packaging_cost / 100, product.extra_cost / 100,
      ]);
    });
    sheet.autoFilter = { from: "A4", to: "I4" };
    for (let row = 5; row <= 1004; row++) {
      sheet.getCell(`A${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"manual,yandex,ozon"'],
        showErrorMessage: true,
        errorTitle: "Неизвестная площадка",
        error: "Выберите manual, yandex или ozon.",
      };
      for (const column of ["F", "G"]) {
        sheet.getCell(`${column}${row}`).dataValidation = {
          type: "whole", operator: "between", formulae: [0, 100000], allowBlank: false,
        };
      }
      for (const column of ["H", "I"]) {
        sheet.getCell(`${column}${row}`).dataValidation = {
          type: "decimal", operator: "between", formulae: [0, 1000000], allowBlank: true,
        };
      }
    }
    sheet.getColumn(8).numFmt = '#,##0.00 "₽"';
    sheet.getColumn(9).numFmt = '#,##0.00 "₽"';
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await workbook.xlsx.writeFile(this.filePath);
  }

  async syncIfChanged(force = false) {
    await this.ensure();
    const stat = await fs.stat(this.filePath);
    if (!force && globalCatalog.productCatalogMtime === stat.mtimeMs) return false;
    const buffer = await fs.readFile(this.filePath);
    await new ImportService(this.storage).importProducts(buffer);
    globalCatalog.productCatalogMtime = stat.mtimeMs;
    return true;
  }
}
