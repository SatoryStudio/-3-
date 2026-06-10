import type {
  PrinterAdapter,
  PrinterConnectionResult,
  PrinterFilamentUsage,
  PrinterHistoryEntry,
  PrinterJobSnapshot,
  PrinterStatus,
} from "@/lib/printers/printer-adapter";

export interface BambuLabCredentials {
  host: string;
  accessCode: string;
  serialNumber: string;
}

export class BambuLabAdapter implements PrinterAdapter {
  constructor(private readonly credentials: BambuLabCredentials) {}

  async testConnection(): Promise<PrinterConnectionResult> {
    if (!this.credentials.host || !this.credentials.accessCode || !this.credentials.serialNumber) {
      return { ok: false, status: "missing_settings", message: "Заполните Host, Access Code и Serial Number" };
    }
    return {
      ok: false,
      status: "adapter_not_enabled",
      message: "Bambu Lab сохранён. Подключение по MQTT будет доступно на следующем этапе",
    };
  }

  async getPrinterStatus(): Promise<PrinterStatus> {
    return { state: "unknown", progress: 0, message: "Bambu Lab MQTT ещё не активирован" };
  }

  async getCurrentPrintJob(): Promise<PrinterJobSnapshot | null> {
    return null;
  }

  async getFilamentUsage(): Promise<PrinterFilamentUsage | null> {
    return null;
  }

  async getPrintHistory(): Promise<PrinterHistoryEntry[]> {
    return [];
  }
}
