import type {
  PrinterAdapter,
  PrinterConnectionResult,
  PrinterFilamentUsage,
  PrinterHistoryEntry,
  PrinterJobSnapshot,
  PrinterStatus,
} from "@/lib/printers/printer-adapter";

export class ManualPrinterAdapter implements PrinterAdapter {
  async testConnection(): Promise<PrinterConnectionResult> {
    return { ok: true, status: "manual", message: "Ручной принтер готов к работе" };
  }

  async getPrinterStatus(): Promise<PrinterStatus> {
    return { state: "idle", progress: 0, message: "Статус управляется вручную" };
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
