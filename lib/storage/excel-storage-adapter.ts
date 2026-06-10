import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import lockfile from "proper-lockfile";
import type { Database, TableName } from "@/lib/domain/types";
import {
  DEFAULT_SETTINGS,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
  TABLE_COLUMNS,
  TABLE_NAMES,
} from "@/lib/storage/schema";
import type { StorageAdapter, UnitOfWork } from "@/lib/storage/storage-adapter";

const BOOLEAN_COLUMNS = new Set(["is_active", "historical"]);
const NUMBER_COLUMNS = new Set([
  "weight_grams", "print_time_minutes", "packaging_cost", "extra_cost", "initial_weight_grams",
  "remaining_weight_grams", "reserved_weight_grams", "price_per_spool", "price_per_kg", "gross_revenue",
  "expected_payout", "actual_payout", "reported_payment_amount", "reported_refund_amount",
  "marketplace_cost", "production_cost", "profit", "margin_percent",
  "quantity", "unit_price", "revenue", "planned_filament_grams", "actual_filament_grams", "failed_filament_grams",
  "filament_cost", "electricity_cost", "allocated_marketplace_cost", "grams", "planned_grams", "actual_grams",
  "failed_grams", "amount", "google_sheet_gid", "google_row_number",
]);

function normalizeValue(key: string, value: ExcelJS.CellValue) {
  const primitive = value && typeof value === "object" && "text" in value ? value.text : value;
  if (BOOLEAN_COLUMNS.has(key)) return primitive === true || primitive === "true" || primitive === 1;
  if (NUMBER_COLUMNS.has(key)) return Number(primitive || 0);
  return primitive === null || primitive === undefined ? "" : String(primitive);
}

export class ExcelStorageAdapter implements StorageAdapter {
  private initialized = false;
  private readonly dataDir: string;
  private readonly lockPath: string;

  constructor(dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data")) {
    this.dataDir = path.resolve(dataDir);
    this.lockPath = path.join(this.dataDir, ".storage.lock");
  }

  async initialize() {
    if (this.initialized) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "backups"), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "transactions"), { recursive: true });
    await fs.writeFile(this.lockPath, "", { flag: "a" });
    for (const table of TABLE_NAMES) {
      try {
        await fs.access(this.filePath(table));
      } catch {
        await this.writeWorkbook(this.filePath(table), table, table === "settings" ? DEFAULT_SETTINGS : []);
      }
    }
    const release = await lockfile.lock(this.lockPath, {
      realpath: false,
      retries: { retries: 40, factor: 1.25, minTimeout: 50, maxTimeout: 500 },
      stale: 30_000,
    });
    try {
      await this.migrateSchemaVersions();
      await this.migrateDefaults();
    } finally {
      await release();
    }
    this.initialized = true;
  }

  async read(): Promise<Database> {
    await this.initialize();
    const entries = await Promise.all(TABLE_NAMES.map(async (table) => [table, await this.readTable(table)] as const));
    return Object.fromEntries(entries) as unknown as Database;
  }

  async transaction<T>(operation: (unit: UnitOfWork) => Promise<T> | T): Promise<T> {
    await this.initialize();
    const release = await lockfile.lock(this.lockPath, {
      realpath: false,
      retries: { retries: 40, factor: 1.25, minTimeout: 50, maxTimeout: 500 },
      stale: 30_000,
    });
    try {
      const working = structuredClone(await this.read());
      const touched = new Set<TableName>();
      const result = await operation({ data: working, touch: (...tables) => tables.forEach((table) => touched.add(table)) });
      if (touched.size) await this.commit(working, [...touched]);
      return result;
    } finally {
      await release();
    }
  }

  private filePath(table: TableName) {
    return path.join(this.dataDir, `${table}.xlsx`);
  }

  private async readTable<T extends TableName>(table: T): Promise<Database[T]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.filePath(table));
    const meta = workbook.getWorksheet("Meta");
    const schemaVersion = Number(meta?.getCell("B2").value);
    if (
      !Number.isFinite(schemaVersion)
      || schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION
      || schemaVersion > SCHEMA_VERSION
    ) {
      throw new Error(`Unsupported schema version in ${table}.xlsx`);
    }
    const sheet = workbook.getWorksheet("Data");
    if (!sheet) throw new Error(`Missing Data sheet in ${table}.xlsx`);
    const columns = TABLE_COLUMNS[table] as readonly string[];
    const headerMap = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, columnNumber) => {
      headerMap.set(String(cell.value || ""), columnNumber);
    });
    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const object: Record<string, unknown> = {};
      columns.forEach((column) => {
        const columnNumber = headerMap.get(column);
        object[column] = normalizeValue(column, columnNumber ? row.getCell(columnNumber).value : "");
      });
      if (table === "settings" && !object.value_type) {
        object.value_type = ["true", "false"].includes(String(object.value)) ? "boolean"
          : Number.isFinite(Number(object.value)) ? "number" : "string";
      }
      if (table === "sync_logs" && !object.operation) {
        const legacyColumn = headerMap.get("sync_type");
        object.operation = legacyColumn ? normalizeValue("operation", row.getCell(legacyColumn).value) : "";
      }
      if (table === "sync_logs") {
        const legacyMessage = headerMap.get("message");
        const legacyCode = headerMap.get("safe_error_code");
        if (!object.run_id) object.run_id = "";
        if (!object.entry_type) object.entry_type = object.status === "error" ? "error" : "step";
        if (!object.summary && legacyMessage) object.summary = normalizeValue("summary", row.getCell(legacyMessage).value);
        if (!object.safe_message && legacyMessage) object.safe_message = normalizeValue("safe_message", row.getCell(legacyMessage).value);
        if (!object.error_code && legacyCode) object.error_code = normalizeValue("error_code", row.getCell(legacyCode).value);
        if (!object.order_id) object.order_id = "";
        if (!object.sku) object.sku = "";
      }
      if (table === "orders") {
        if (!object.problem_code) object.problem_code = "";
        if (!object.problem_message) object.problem_message = "";
        if (!object.marketplace_substatus) object.marketplace_substatus = "";
        if (!object.delivery_date) object.delivery_date = "";
        if (!object.reported_payment_amount) object.reported_payment_amount = 0;
        if (!object.reported_refund_amount) object.reported_refund_amount = 0;
        if (!object.payment_status) object.payment_status = "not_available";
        if (!object.payment_date) object.payment_date = "";
        if (!object.payout_date) object.payout_date = "";
        if (!object.payment_order_id) object.payment_order_id = "";
        if (!object.profit_status) {
          object.profit_status = [
            "SKU_NOT_FOUND", "PRODUCT_NOT_FOUND", "FILAMENT_NOT_FOUND",
            "FILAMENT_NOT_ENOUGH", "COST_NOT_CALCULATED",
          ].includes(String(object.problem_code)) ? "incomplete" : "complete";
        }
        object.internal_status = ({
          reserved: "in_production",
          needs_print: "in_production",
          printing: "in_production",
          packed: "ready_to_ship",
          shipped: "in_transit",
        } as Record<string, string>)[String(object.internal_status)] || object.internal_status;
      }
      if (table === "filament_spools") {
        if (!object.google_spreadsheet_id) object.google_spreadsheet_id = "";
        if (!object.google_sheet_gid) object.google_sheet_gid = 0;
        if (!object.google_row_number) object.google_row_number = 0;
        if (!object.google_row_fingerprint) object.google_row_fingerprint = "";
      }
      if (table === "financial_operations" && object.type === "promotion") object.type = "boost";
      if (table === "print_jobs" && !object.usage_source) object.usage_source = "planned";
      if (Object.values(object).some((value) => value !== "")) rows.push(object);
    });
    return rows as unknown as Database[T];
  }

  private async migrateDefaults() {
    const settings = await this.readTable("settings");
    const missing = DEFAULT_SETTINGS.filter((defaultSetting) =>
      !settings.some((setting) => setting.key === defaultSetting.key));
    if (!missing.length) return;
    await this.writeWorkbook(this.filePath("settings"), "settings", [...settings, ...missing]);
  }

  private async migrateSchemaVersions() {
    const stamp = `schema-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const backupDir = path.join(this.dataDir, "backups", stamp);
    const transactionDir = path.join(this.dataDir, "transactions", `${stamp}-${crypto.randomUUID()}`);
    const migrated: TableName[] = [];
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(transactionDir, { recursive: true });
    try {
      for (const table of TABLE_NAMES) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(this.filePath(table));
        const version = Number(workbook.getWorksheet("Meta")?.getCell("B2").value);
        if (version === SCHEMA_VERSION) continue;
        const rows = await this.readTable(table);
        await fs.copyFile(this.filePath(table), path.join(backupDir, `${table}.xlsx`));
        const staged = path.join(transactionDir, `${table}.xlsx`);
        await this.writeWorkbook(staged, table, rows);
        const verification = new ExcelJS.Workbook();
        await verification.xlsx.readFile(staged);
        if (!verification.getWorksheet("Data") || Number(verification.getWorksheet("Meta")?.getCell("B2").value) !== SCHEMA_VERSION) {
          throw new Error(`Schema migration verification failed for ${table}.xlsx`);
        }
        migrated.push(table);
      }
      for (const table of migrated) {
        await fs.rename(path.join(transactionDir, `${table}.xlsx`), this.filePath(table));
      }
    } catch (error) {
      for (const table of migrated) {
        try { await fs.copyFile(path.join(backupDir, `${table}.xlsx`), this.filePath(table)); } catch {}
      }
      throw error;
    } finally {
      await fs.rm(transactionDir, { recursive: true, force: true });
      if (!migrated.length) await fs.rm(backupDir, { recursive: true, force: true });
    }
  }

  getDataDir() {
    return this.dataDir;
  }

  async validateTable(table: TableName) {
    await this.initialize();
    await this.readTable(table);
  }

  async testTransactionDirectory() {
    await this.initialize();
    const file = path.join(this.dataDir, "transactions", `.diagnostic-${crypto.randomUUID()}.tmp`);
    await fs.writeFile(file, "ok", { mode: 0o600 });
    const value = await fs.readFile(file, "utf8");
    await fs.rm(file, { force: true });
    if (value !== "ok") throw new Error("Transaction directory verification failed");
  }

  async createFullBackup() {
    await this.initialize();
    const release = await lockfile.lock(this.lockPath, {
      realpath: false,
      retries: { retries: 40, factor: 1.25, minTimeout: 50, maxTimeout: 500 },
      stale: 30_000,
    });
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupDir = path.join(this.dataDir, "backups", `full-${stamp}`);
      await fs.mkdir(backupDir, { recursive: true });
      const entries = await fs.readdir(this.dataDir, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".xlsx"));
      await Promise.all(files.map((entry) =>
        fs.copyFile(path.join(this.dataDir, entry.name), path.join(backupDir, entry.name))));
      return { path: backupDir, files: files.length };
    } finally {
      await release();
    }
  }

  private async writeWorkbook(file: string, table: TableName, rows: unknown[]) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Filament ERP";
    const sheet = workbook.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
    const columns = TABLE_COLUMNS[table] as readonly string[];
    sheet.columns = columns.map((column) => ({ header: column, key: column, width: Math.min(32, Math.max(12, column.length + 2)) }));
    rows.forEach((row) => sheet.addRow(row));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171514" } };
    const meta = workbook.addWorksheet("Meta");
    meta.addRows([["table", table], ["schema_version", SCHEMA_VERSION]]);
    await workbook.xlsx.writeFile(file);
  }

  private async commit(database: Database, tables: TableName[]) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(this.dataDir, "backups", stamp);
    const transactionDir = path.join(this.dataDir, "transactions", `${stamp}-${crypto.randomUUID()}`);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(transactionDir, { recursive: true });
    try {
      for (const table of tables) {
        await fs.copyFile(this.filePath(table), path.join(backupDir, `${table}.xlsx`));
        const staged = path.join(transactionDir, `${table}.xlsx`);
        await this.writeWorkbook(staged, table, database[table]);
        const verification = new ExcelJS.Workbook();
        await verification.xlsx.readFile(staged);
        if (!verification.getWorksheet("Data") || !verification.getWorksheet("Meta")) throw new Error(`Verification failed for ${table}.xlsx`);
      }
      for (const table of tables) await fs.rename(path.join(transactionDir, `${table}.xlsx`), this.filePath(table));
    } catch (error) {
      for (const table of tables) {
        try { await fs.copyFile(path.join(backupDir, `${table}.xlsx`), this.filePath(table)); } catch {}
      }
      throw error;
    } finally {
      await fs.rm(transactionDir, { recursive: true, force: true });
    }
  }
}
