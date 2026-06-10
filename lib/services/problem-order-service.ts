import type { IncomingOrder } from "@/lib/domain/types";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { profitCalculationService } from "@/lib/services/profit-calculation-service";
import type { ProblemRetryReport } from "@/lib/services/sync-report";
import { SyncLogService } from "@/lib/services/sync-log-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

export class ProblemOrderService {
  private readonly logs: SyncLogService;

  constructor(private readonly storage: StorageAdapter) {
    this.logs = new SyncLogService(storage);
  }

  async retryAll(runId = ""): Promise<ProblemRetryReport> {
    const database = await this.storage.read();
    const candidates = database.orders.filter(
      (order) => order.internal_status === "problem" || order.internal_status === "new",
    );
    const report: ProblemRetryReport = {
      status: "success",
      attempted: candidates.length,
      resolved: 0,
      remaining: 0,
      errors: 0,
    };

    for (const order of candidates) {
      const items = database.order_items.filter((item) => item.order_id === order.id);
      const incoming: IncomingOrder = {
        marketplace: order.marketplace,
        marketplace_order_id: order.marketplace_order_id,
        marketplace_status: order.marketplace_status,
        marketplace_substatus: order.marketplace_substatus,
        order_date: order.order_date,
        shipment_date: order.shipment_date,
        delivery_date: order.delivery_date,
        historical: order.historical,
        items: items.map((item) => ({
          marketplace_sku: item.marketplace_sku,
          name: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      };
      try {
        const result = await this.storage.transaction((unit) => orderIngestionService.ingest(unit, incoming));
        if (result.outcome === "problem") {
          report.remaining++;
          await this.logs.append({
            runId,
            entryType: "problem",
            source: order.marketplace,
            operation: "retry_problem_orders",
            status: "success",
            errorCode: result.problemCode,
            safeMessage: result.problemMessage,
            orderId: order.marketplace_order_id,
            sku: result.sku,
          });
        } else {
          report.resolved++;
        }
      } catch {
        report.errors++;
        await this.logs.append({
          runId,
          entryType: "error",
          source: order.marketplace,
          operation: "retry_problem_orders",
          status: "error",
          errorCode: "UNKNOWN_ERROR",
          safeMessage: "Не удалось повторно обработать заказ",
          orderId: order.marketplace_order_id,
        });
      }
    }
    report.status = report.errors ? "error" : report.remaining ? "completed_with_problems" : "success";
    return report;
  }

  async checkReservations(runId = ""): Promise<ProblemRetryReport> {
    const report: ProblemRetryReport = {
      status: "success",
      attempted: 0,
      resolved: 0,
      remaining: 0,
      errors: 0,
    };
    const database = await this.storage.read();
    for (const item of database.order_items.filter((candidate) => candidate.reserved_filament_grams > 0)) {
      const spool = database.filament_spools.find((candidate) => candidate.id === item.spool_id);
      if (!spool || spool.reserved_weight_grams < item.reserved_filament_grams) {
        report.errors++;
        await this.logs.append({
          runId,
          entryType: "error",
          source: "inventory",
          operation: "validate_reservations",
          status: "error",
          errorCode: "STORAGE_ERROR",
          safeMessage: "Нарушена целостность резерва филамента",
          orderId: database.orders.find((order) => order.id === item.order_id)?.marketplace_order_id || "",
          sku: item.marketplace_sku,
        });
      }
    }
    report.status = report.errors ? "error" : report.remaining ? "completed_with_problems" : "success";
    return report;
  }

  async recalculateAffected() {
    return this.storage.transaction((unit) => {
      const ids = unit.data.orders.map((order) => order.id);
      ids.forEach((id) => profitCalculationService.recalculateOrder(unit, id));
      return ids.length;
    });
  }
}
