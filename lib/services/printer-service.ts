import type { Printer, PrinterType } from "@/lib/domain/types";
import { BambuLabAdapter } from "@/lib/printers/bambu-lab-adapter";
import { ManualPrinterAdapter } from "@/lib/printers/manual-printer-adapter";
import type { PrinterAdapter } from "@/lib/printers/printer-adapter";
import { SecretService } from "@/lib/services/secret-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

export class PrinterService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly secrets: SecretService,
  ) {}

  async list() {
    const database = await this.storage.read();
    return database.printers.map((printer) => this.masked(printer));
  }

  async save(input: Record<string, unknown>) {
    const id = String(input.id || crypto.randomUUID());
    const name = String(input.name || "").trim();
    const type = String(input.type || "manual") as PrinterType;
    const host = String(input.host || "").trim();
    const serialNumber = String(input.serial_number || "").trim();
    const accessCode = String(input.access_code || "").trim();
    const isActive = input.is_active === true || input.is_active === "true" || input.is_active === "on";
    if (!name) throw new Error("Укажите название принтера");
    if (!["manual", "bambu_lab"].includes(type)) throw new Error("Неизвестный тип принтера");
    if (type === "bambu_lab" && (!host || !serialNumber)) {
      throw new Error("Для Bambu Lab нужны Host и Serial Number");
    }
    const encrypted = accessCode
      ? await this.secrets.encrypt(accessCode, `printer:${id}:access_code`)
      : "";
    await this.storage.transaction((unit) => {
      const now = new Date().toISOString();
      const existing = unit.data.printers.find((item) => item.id === id);
      if (existing) {
        existing.name = name;
        existing.type = type;
        existing.host = host;
        existing.serial_number = serialNumber;
        existing.is_active = isActive;
        if (encrypted) existing.access_code_encrypted = encrypted;
        existing.updated_at = now;
      } else {
        unit.data.printers.push({
          id,
          name,
          type,
          host,
          access_code_encrypted: encrypted,
          serial_number: serialNumber,
          is_active: isActive,
          last_status: "unknown",
          last_seen_at: "",
          created_at: now,
          updated_at: now,
        });
      }
      unit.touch("printers");
    });
    return this.get(id);
  }

  async delete(id: string) {
    await this.storage.transaction((unit) => {
      if (unit.data.print_jobs.some((job) => job.printer_id === id && job.status === "printing")) {
        throw new Error("Нельзя удалить принтер с активной печатью");
      }
      unit.data.printers = unit.data.printers.filter((item) => item.id !== id);
      unit.data.print_jobs.forEach((job) => {
        if (job.printer_id === id) job.printer_id = "";
      });
      unit.touch("printers", "print_jobs");
    });
  }

  async test(id: string) {
    const printer = await this.getRaw(id);
    const result = await (await this.adapter(printer)).testConnection();
    await this.storage.transaction((unit) => {
      const current = unit.data.printers.find((item) => item.id === id);
      if (!current) return;
      current.last_status = result.status;
      current.last_seen_at = result.ok ? new Date().toISOString() : current.last_seen_at;
      current.updated_at = new Date().toISOString();
      unit.touch("printers");
    });
    return result;
  }

  async statuses() {
    const database = await this.storage.read();
    return Promise.all(database.printers.filter((item) => item.is_active).map(async (printer) => {
      const assigned = database.print_jobs.find((job) =>
        job.printer_id === printer.id && job.status === "printing");
      const status = assigned
        ? { state: "printing" as const, progress: 0, message: "Печать отмечена в ERP" }
        : await (await this.adapter(printer)).getPrinterStatus();
      return { ...this.masked(printer), status, current_job: assigned || null };
    }));
  }

  private async get(id: string) {
    return this.masked(await this.getRaw(id));
  }

  private async getRaw(id: string) {
    const printer = (await this.storage.read()).printers.find((item) => item.id === id);
    if (!printer) throw new Error("Принтер не найден");
    return printer;
  }

  private masked(printer: Printer) {
    return {
      ...printer,
      access_code_encrypted: undefined,
      access_code_configured: Boolean(printer.access_code_encrypted),
      access_code_mask: printer.access_code_encrypted ? "••••••••" : "",
    };
  }

  private async adapter(printer: Printer): Promise<PrinterAdapter> {
    if (printer.type === "manual") return new ManualPrinterAdapter();
    const accessCode = printer.access_code_encrypted
      ? await this.secrets.decrypt(printer.access_code_encrypted, `printer:${printer.id}:access_code`)
      : "";
    return new BambuLabAdapter({
      host: printer.host,
      accessCode,
      serialNumber: printer.serial_number,
    });
  }
}
