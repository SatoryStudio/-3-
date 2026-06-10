import type { FinancialOperationType } from "@/lib/domain/types";
import type { SyncPeriod } from "@/lib/integrations/marketplace-adapter";
import { classifyIntegrationError } from "@/lib/integrations/integration-error";
import { OzonAdapter } from "@/lib/integrations/ozon-adapter";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { profitCalculationService } from "@/lib/services/profit-calculation-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import { IntegrationSettingsService } from "@/lib/services/integration-settings-service";

export class OzonSyncService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly settings: IntegrationSettingsService,
    private readonly suppliedAdapter?: OzonAdapter,
  ) {}

  async run(action: "test" | "orders" | "statuses" | "finance", period: SyncPeriod) {
    const started = new Date().toISOString();
    const logId = crypto.randomUUID();
    await this.storage.transaction((unit) => {
      unit.data.sync_logs.push({
        id: logId, run_id: "", entry_type: "step", source: "ozon", operation: action, status: "started",
        started_at: started, finished_at: "", summary: "", error_code: "", safe_message: "",
        order_id: "", sku: "", period_from: period.from, period_to: period.to, created_at: started,
      });
      unit.touch("sync_logs");
    });
    try {
      const adapter = this.suppliedAdapter || new OzonAdapter(await this.settings.getOzonCredentials());
      let message = "";
      if (action === "test") {
        const result = await adapter.testConnection();
        message = `Подключение работает: ${result.name}`;
      } else if (action === "finance") {
        const operations = await adapter.syncFinance(period);
        await this.storage.transaction((unit) => {
          const affected = new Set<string>();
          for (const operation of operations) {
            if (unit.data.financial_operations.some((item) => item.marketplace === "ozon" && item.operation_id === operation.operation_id)) continue;
            const order = unit.data.orders.find((item) =>
              item.marketplace === "ozon" && item.marketplace_order_id === operation.marketplace_order_id);
            unit.data.financial_operations.push({
              id: crypto.randomUUID(), marketplace: "ozon", order_id: order?.id || "",
              marketplace_order_id: operation.marketplace_order_id, operation_id: operation.operation_id,
              operation_date: operation.operation_date, type: operation.type as FinancialOperationType,
              amount: operation.amount, description: operation.description, match_status: order ? "matched" : "unmatched",
              raw_payload: JSON.stringify(operation.raw_payload), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            });
            if (order) affected.add(order.id);
          }
          unit.touch("financial_operations");
          affected.forEach((orderId) => profitCalculationService.recalculateOrder(unit, orderId));
        });
        message = `Финансовых операций Ozon обработано: ${operations.length}`;
      } else {
        const orders = action === "orders" ? await adapter.syncOrders(period) : await adapter.syncStatuses(period);
        let imported = 0;
        const errors: string[] = [];
        for (const order of orders) {
          try {
            await this.storage.transaction((unit) => orderIngestionService.ingest(unit, order));
            imported++;
          } catch (error) {
            errors.push(`${order.marketplace_order_id}: ${error instanceof Error ? error.message : "ошибка"}`);
          }
        }
        message = `Заказов Ozon обработано: ${imported}${errors.length ? `, ошибок: ${errors.length}` : ""}`;
      }
      await this.finishLog(logId, "success", message);
      return { message };
    } catch (error) {
      const safe = classifyIntegrationError(error);
      await this.finishLog(logId, "error", safe.message, safe.code);
      throw Object.assign(new Error(safe.message), { code: safe.code });
    }
  }

  private async finishLog(id: string, status: "success" | "error", message: string, safeErrorCode = "") {
    await this.storage.transaction((unit) => {
      const log = unit.data.sync_logs.find((item) => item.id === id);
      if (!log) return;
      log.status = status;
      log.summary = message.slice(0, 1000);
      log.safe_message = status === "error" ? message.slice(0, 1000) : "";
      log.error_code = safeErrorCode;
      log.finished_at = new Date().toISOString();
      unit.touch("sync_logs");
    });
  }
}
