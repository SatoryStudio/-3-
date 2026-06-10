export interface PrinterConnectionResult {
  ok: boolean;
  status: string;
  message: string;
}

export interface PrinterStatus {
  state: "idle" | "printing" | "offline" | "unknown";
  progress: number;
  message: string;
}

export interface PrinterJobSnapshot {
  external_id: string;
  name: string;
  started_at: string;
  progress: number;
}

export interface PrinterFilamentUsage {
  grams: number;
  source: "printer" | "history";
  measured_at: string;
}

export interface PrinterHistoryEntry {
  external_id: string;
  name: string;
  status: "success" | "failed" | "cancelled";
  filament_grams: number;
  started_at: string;
  finished_at: string;
}

export interface PrinterAdapter {
  testConnection(): Promise<PrinterConnectionResult>;
  getPrinterStatus(): Promise<PrinterStatus>;
  getCurrentPrintJob(): Promise<PrinterJobSnapshot | null>;
  getFilamentUsage(): Promise<PrinterFilamentUsage | null>;
  getPrintHistory(): Promise<PrinterHistoryEntry[]>;
}
