import { describe, expect, it } from "vitest";
import type { Database, IncomingOrder } from "@/lib/domain/types";
import { YandexSyncService } from "@/lib/integrations/yandex-sync-service";
import { FullSyncService } from "@/lib/services/full-sync-service";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { ProblemOrderService } from "@/lib/services/problem-order-service";
import { emptyFinanceReport, emptyOrderReport } from "@/lib/services/sync-report";
import { SyncLogService } from "@/lib/services/sync-log-service";
import type { StorageAdapter, UnitOfWork } from "@/lib/storage/storage-adapter";
import { emptyDatabase, product, spool, unit } from "@/tests/helpers";

class MemoryStorage implements StorageAdapter {
  constructor(public data: Database = emptyDatabase()) {}
  async initialize() {}
  async read() { return structuredClone(this.data); }
  async transaction<T>(operation: (unit: UnitOfWork) => Promise<T> | T) {
    const working = structuredClone(this.data);
    const result = await operation({ data: working, touch: () => {} });
    this.data = working;
    return result;
  }
}

function incoming(id: string, sku = "UNKNOWN"): IncomingOrder {
  return {
    marketplace: "yandex",
    marketplace_order_id: id,
    marketplace_status: "PROCESSING",
    order_date: "2026-06-07T00:00:00.000Z",
    items: [{ marketplace_sku: sku, name: `Товар ${sku}`, quantity: 1, unit_price: 10000 }],
  };
}

describe("Synchronization diagnostics", () => {
  it("stores 35 unknown-SKU orders as problems without technical errors", async () => {
    const storage = new MemoryStorage();
    const orders = Array.from({ length: 35 }, (_, index) => incoming(String(index + 1)));
    const adapter = {
      syncOrders: async () => orders,
      syncStatuses: async () => orders,
      syncFinance: async () => [],
      testConnection: async () => ({ ok: true as const, name: "Test" }),
    };
    const service = new YandexSyncService(storage, {} as never, adapter as never);
    const result = await service.run("orders", {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-07T00:00:00.000Z",
    });

    expect(result.report).toMatchObject({
      loaded: 35,
      created: 35,
      problem: 35,
      errors: 0,
    });
    expect(storage.data.orders).toHaveLength(35);
    expect(storage.data.order_items).toHaveLength(35);
    expect(storage.data.orders.every((order) =>
      order.internal_status === "problem" && order.problem_code === "SKU_NOT_FOUND")).toBe(true);
    expect(storage.data.sync_logs.filter((log) => log.entry_type === "problem")).toHaveLength(35);
  });

  it("keeps all order items and creates no partial reserve when one SKU is unknown", () => {
    const data = emptyDatabase();
    data.products.push(product({ marketplace: "yandex", marketplace_sku: "KNOWN" }));
    data.filament_spools.push(spool());
    const result = orderIngestionService.ingest(unit(data), {
      ...incoming("multi", "KNOWN"),
      items: [
        { marketplace_sku: "KNOWN", quantity: 1, unit_price: 10000 },
        { marketplace_sku: "UNKNOWN", quantity: 2, unit_price: 20000 },
      ],
    });

    expect(result.outcome).toBe("problem");
    expect(data.order_items).toHaveLength(2);
    expect(data.filament_spools[0].reserved_weight_grams).toBe(0);
    expect(data.filament_movements).toHaveLength(0);
    expect(data.print_jobs).toHaveLength(0);
  });

  it("retries a problem order after product and filament appear", async () => {
    const storage = new MemoryStorage();
    await storage.transaction((work) => orderIngestionService.ingest(work, incoming("retry", "SKU-1")));
    storage.data.products.push(product({ marketplace: "yandex", marketplace_sku: "SKU-1" }));
    storage.data.filament_spools.push(spool());

    const first = await new ProblemOrderService(storage).retryAll();
    const second = await new ProblemOrderService(storage).retryAll();

    expect(first).toMatchObject({ attempted: 1, resolved: 1, remaining: 0, errors: 0 });
    expect(second).toMatchObject({ attempted: 0, resolved: 0 });
    expect(storage.data.orders[0].internal_status).toBe("waiting_production");
    expect(storage.data.filament_spools[0].reserved_weight_grams).toBe(100);
    expect(storage.data.print_jobs).toHaveLength(1);
  });

  it("clears a resolved historical problem into its marketplace terminal status", async () => {
    const storage = new MemoryStorage();
    await storage.transaction((work) => orderIngestionService.ingest(work, {
      ...incoming("historical", "SKU-1"),
      marketplace_status: "DELIVERED",
      historical: true,
    }));
    storage.data.products.push(product({ marketplace: "yandex", marketplace_sku: "SKU-1" }));
    storage.data.filament_spools.push(spool());

    const report = await new ProblemOrderService(storage).retryAll();

    expect(report).toMatchObject({ resolved: 1, remaining: 0, errors: 0 });
    expect(storage.data.orders[0]).toMatchObject({
      internal_status: "delivered",
      problem_code: "",
      problem_message: "",
    });
    expect(storage.data.print_jobs).toHaveLength(0);
    expect(storage.data.filament_spools[0].reserved_weight_grams).toBe(0);
  });

  it("does not rebuild items or reserves after production starts", () => {
    const data = emptyDatabase();
    data.products.push(product({ marketplace: "yandex", marketplace_sku: "SKU-1" }));
    data.filament_spools.push(spool());
    orderIngestionService.ingest(unit(data), incoming("locked", "SKU-1"));
    data.print_jobs[0].status = "printing";
    data.print_jobs[0].started_at = "2026-06-07T01:00:00.000Z";
    const itemId = data.order_items[0].id;
    const jobId = data.print_jobs[0].id;
    const reserved = data.filament_spools[0].reserved_weight_grams;

    const result = orderIngestionService.ingest(unit(data), {
      ...incoming("locked", "SKU-1"),
      marketplace_status: "DELIVERY",
      shipment_date: "2026-06-08",
      delivery_date: "2026-06-09",
      raw_payload: { status: "DELIVERY", safe: true },
      items: [{ marketplace_sku: "SKU-1", quantity: 2, unit_price: 20000 }],
    });

    expect(result.outcome).toBe("production_locked");
    expect(data.order_items[0].id).toBe(itemId);
    expect(data.print_jobs[0].id).toBe(jobId);
    expect(data.filament_spools[0].reserved_weight_grams).toBe(reserved);
    expect(data.order_items[0].quantity).toBe(1);
    expect(data.orders[0]).toMatchObject({
      marketplace_status: "DELIVERY",
      shipment_date: "2026-06-08",
      delivery_date: "2026-06-09",
    });
    expect(JSON.parse(data.orders[0].raw_payload)).toMatchObject({ status: "DELIVERY", safe: true });
  });

  it("continues independent full-sync steps and reports partial status", async () => {
    const storage = new MemoryStorage();
    const fakeYandex = {
      run: async (action: string) => {
        if (action === "orders") throw new Error("API down");
        if (action === "statuses") return {
          report: { ...emptyOrderReport(), loaded: 1, updated: 1 },
          message: "ok",
        };
        return { report: emptyFinanceReport(), message: "ok" };
      },
    };
    const service = new FullSyncService(storage, {} as never, () => fakeYandex as never);
    const report = await service.run({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-07T00:00:00.000Z",
    });

    expect(report.status).toBe("partial");
    expect(report.googleProducts).toMatchObject({ status: "skipped", reason: "not_configured" });
    expect(report.yandexOrders.errors).toBe(1);
    expect(report.yandexStatuses.loaded).toBe(1);
  });

  it("redacts credential-like values from safe logs", () => {
    const log = new SyncLogService().create({
      entryType: "error",
      source: "test",
      operation: "sync",
      status: "error",
      safeMessage: "api_key=secret-value token: abcdef",
    });
    expect(log.safe_message).not.toContain("secret-value");
    expect(log.safe_message).not.toContain("abcdef");
  });
});
