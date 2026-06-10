import fs from "node:fs/promises";
import path from "node:path";
import { TABLE_NAMES } from "@/lib/storage/schema";
import type { ExcelStorageAdapter } from "@/lib/storage/excel-storage-adapter";

export class StorageDiagnosticsService {
  constructor(private readonly storage: ExcelStorageAdapter) {}

  async diagnose() {
    const dataDir = this.storage.getDataDir();
    const errors: string[] = [];
    for (const table of TABLE_NAMES) {
      try {
        await this.storage.validateTable(table);
      } catch {
        errors.push(`${table}.xlsx`);
      }
    }
    try {
      await this.storage.testTransactionDirectory();
    } catch {
      errors.push("transactions");
    }
    const database = await this.storage.read();
    const entries = await fs.readdir(dataDir, { withFileTypes: true });
    const xlsxFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".xlsx")).length;
    const backupRoot = path.join(dataDir, "backups");
    const backups = await fs.readdir(backupRoot, { withFileTypes: true }).catch(() => []);
    const latestBackup = backups
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1) || "";
    return {
      ok: errors.length === 0,
      path: dataDir,
      xlsxFiles,
      orders: database.orders.length,
      products: database.products.length,
      spools: database.filament_spools.length,
      movements: database.filament_movements.length,
      printers: database.printers.length,
      latestBackup,
      errors,
    };
  }

  createBackup() {
    return this.storage.createFullBackup();
  }
}
