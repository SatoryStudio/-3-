import type { FinancialOperationType, SyncTechnicalErrorCode } from "@/lib/domain/types";
import { classifyIntegrationError } from "@/lib/integrations/integration-error";
import type { SyncPeriod } from "@/lib/integrations/marketplace-adapter";
import { YandexMarketAdapter } from "@/lib/integrations/yandex-market-adapter";
import {
  OrderIngestionError,
  orderIngestionService,
} from "@/lib/services/order-ingestion-service";
import { profitCalculationService } from "@/lib/services/profit-calculation-service";
import {
  emptyFinanceReport,
  emptyOrderReport,
  type FinanceSyncReport,
  type OrderSyncReport,
} from "@/lib/services/sync-report";
import { SyncLogService } from "@/lib/services/sync-log-service";
import type { IntegrationSettingsService } from "@/lib/services/integration-settings-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

export interface YandexSyncOptions {
  runId?: string;
}

export class YandexSyncService {
  private readonly logs: SyncLogService;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly settings: IntegrationSettingsService,
    private readonly suppliedAdapter?: YandexMarketAdapter,
  ) {
    this.logs = new SyncLogService(storage);
  }

  async run(
    action: "test" | "orders" | "statuses" | "finance",
    period: SyncPeriod,
    options: YandexSyncOptions = {},
  ) {
    const operation = action === "test" ? "test_connection" : `sync_${action}`;
    const logId = await this.startLog(operation, period, options.runId);
    try {
      const adapter = this.suppliedAdapter
        || new YandexMarketAdapter(await this.settings.getYandexCredentials());
      if (action === "test") {
        const result = await adapter.testConnection();
        const message = `Подключение работает: ${result.name}`;
        await this.finishLog(logId, "success", message);
        return { message };
      }
      if (action === "finance") {
        const report = await this.syncFinance(adapter, period);
        const message = `Финансы: загружено ${report.loaded}, сопоставлено ${report.matched}, не сопоставлено ${report.unmatched}`;
        await this.finishLog(logId, report.errors ? "error" : "success", message);
        return { message, report };
      }
      const orders = action === "orders"
        ? await adapter.syncOrders(period)
        : await adapter.syncStatuses(period);
      const report = emptyOrderReport();
      report.loaded = orders.length;
      for (const incoming of orders) {
        try {
          const processed = await this.storage.transaction((unit) => {
            const existed = unit.data.orders.some(
              (order) => order.marketplace === incoming.marketplace
                && order.marketplace_order_id === incoming.marketplace_order_id,
            );
            const ingestion = action === "statuses"
              ? orderIngestionService.updateMarketplaceState(unit, incoming)
              : orderIngestionService.ingest(unit, incoming);
            if (ingestion.outcome === "problem") {
              new SyncLogService().appendToUnit(unit, {
                runId: options.runId,
                entryType: "problem",
                source: "yandex",
                operation,
                status: "success",
                errorCode: ingestion.problemCode,
                safeMessage: ingestion.problemMessage,
                orderId: incoming.marketplace_order_id,
                sku: ingestion.sku,
                periodFrom: period.from,
                periodTo: period.to,
              });
            }
            return { ingestion, existed };
          });
          if (processed.existed) report.updated++;
          else report.created++;
          if (processed.ingestion.outcome === "problem") report.problem++;
          if (processed.ingestion.outcome === "production_locked") report.productionLocked++;
        } catch (error) {
          report.errors++;
          await this.logOrderError(operation, period, incoming.marketplace_order_id, error, options.runId);
        }
      }
      report.status = report.errors
        ? "error"
        : report.problem
          ? "completed_with_problems"
          : "success";
      const message = [
        `Загружено: ${report.loaded}`,
        `создано: ${report.created}`,
        `обновлено: ${report.updated}`,
        `problem: ${report.problem}`,
        `ошибок: ${report.errors}`,
      ].join(", ");
      await this.finishLog(logId, report.errors ? "error" : "success", message);
      return { message, report };
    } catch (error) {
      const safe = classifyIntegrationError(error);
      await this.finishLog(logId, "error", safe.message, this.technicalCode(safe.code));
      throw Object.assign(new Error(safe.message), { code: safe.code });
    }
  }

  private async syncFinance(adapter: YandexMarketAdapter, period: SyncPeriod): Promise<FinanceSyncReport> {
    const operations = await adapter.syncFinance(period);
    const report = emptyFinanceReport();
    report.loaded = operations.length;
    await this.storage.transaction((unit) => {
      const affected = new Set<string>();
      for (const operation of operations) {
        const order = unit.data.orders.find((item) =>
          item.marketplace === "yandex" && item.marketplace_order_id === operation.marketplace_order_id);
        if (order) report.matched++;
        else report.unmatched++;
        const existing = unit.data.financial_operations.find(
          (item) => item.marketplace === "yandex" && item.operation_id === operation.operation_id,
        );
        if (existing) {
          existing.order_id = order?.id || "";
          existing.marketplace_order_id = operation.marketplace_order_id;
          existing.operation_date = operation.operation_date;
          existing.type = operation.type as FinancialOperationType;
          existing.amount = operation.amount;
          existing.description = operation.description;
          existing.match_status = order ? "matched" : "unmatched";
          existing.updated_at = new Date().toISOString();
        } else {
          unit.data.financial_operations.push({
            id: crypto.randomUUID(),
            marketplace: "yandex",
            order_id: order?.id || "",
            marketplace_order_id: operation.marketplace_order_id,
            operation_id: operation.operation_id,
            operation_date: operation.operation_date,
            type: operation.type as FinancialOperationType,
            amount: operation.amount,
            description: operation.description,
            match_status: order ? "matched" : "unmatched",
            raw_payload: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        if (order) affected.add(order.id);
      }
      unit.touch("financial_operations");
      affected.forEach((orderId) => profitCalculationService.recalculateOrder(unit, orderId));
    });
    return report;
  }

  private async startLog(operation: string, period: SyncPeriod, runId = "") {
    const log = await this.logs.append({
      runId,
      entryType: "step",
      source: "yandex",
      operation,
      status: "started",
      periodFrom: period.from,
      periodTo: period.to,
    });
    return log.id;
  }

  private async finishLog(
    id: string,
    status: "success" | "error",
    summary: string,
    errorCode = "",
  ) {
    await this.storage.transaction((unit) => {
      const log = unit.data.sync_logs.find((item) => item.id === id);
      if (!log) return;
      log.status = status;
      log.summary = summary.slice(0, 1000);
      log.safe_message = status === "error" ? summary.slice(0, 1000) : "";
      log.error_code = errorCode;
      log.finished_at = new Date().toISOString();
      unit.touch("sync_logs");
    });
  }

  private async logOrderError(
    operation: string,
    period: SyncPeriod,
    orderId: string,
    error: unknown,
    runId = "",
  ) {
    const code = error instanceof OrderIngestionError ? error.code : "UNKNOWN_ERROR";
    const message = error instanceof OrderIngestionError ? error.message : "Не удалось обработать заказ";
    await this.logs.append({
      runId,
      entryType: "error",
      source: "yandex",
      operation,
      status: "error",
      errorCode: code,
      safeMessage: message,
      orderId,
      sku: error instanceof OrderIngestionError ? error.sku : "",
      periodFrom: period.from,
      periodTo: period.to,
    });
  }

  private technicalCode(code: string): SyncTechnicalErrorCode {
    if (["invalid_key", "forbidden", "rate_limit", "api_error", "missing_campaign", "missing_business"].includes(code)) {
      return "YANDEX_API_ERROR";
    }
    return "UNKNOWN_ERROR";
  }
}
