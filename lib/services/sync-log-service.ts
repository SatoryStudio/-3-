import type { SyncLog } from "@/lib/domain/types";
import type { StorageAdapter, UnitOfWork } from "@/lib/storage/storage-adapter";

export interface SyncLogInput {
  runId?: string;
  entryType: SyncLog["entry_type"];
  source: string;
  operation: string;
  status: SyncLog["status"];
  summary?: string;
  errorCode?: string;
  safeMessage?: string;
  orderId?: string;
  sku?: string;
  periodFrom?: string;
  periodTo?: string;
  startedAt?: string;
  finishedAt?: string;
}

export class SyncLogService {
  constructor(private readonly storage?: StorageAdapter) {}

  create(input: SyncLogInput): SyncLog {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      run_id: input.runId || "",
      entry_type: input.entryType,
      source: input.source,
      operation: input.operation,
      status: input.status,
      started_at: input.startedAt || now,
      finished_at: input.finishedAt ?? (input.status === "started" ? "" : now),
      summary: this.safe(input.summary),
      error_code: input.errorCode || "",
      safe_message: this.safe(input.safeMessage),
      order_id: input.orderId || "",
      sku: input.sku || "",
      period_from: input.periodFrom || "",
      period_to: input.periodTo || "",
      created_at: input.startedAt || now,
    };
  }

  appendToUnit(unit: UnitOfWork, input: SyncLogInput) {
    const log = this.create(input);
    unit.data.sync_logs.push(log);
    unit.touch("sync_logs");
    return log;
  }

  async append(input: SyncLogInput) {
    if (!this.storage) throw new Error("StorageAdapter не задан");
    return this.storage.transaction((unit) => this.appendToUnit(unit, input));
  }

  private safe(value?: string) {
    return String(value || "")
      .replace(/(api[-_ ]?key|oauth|token|authorization)\s*[:=]\s*\S+/gi, "$1: [скрыто]")
      .slice(0, 1000);
  }
}

