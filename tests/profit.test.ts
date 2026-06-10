import { describe, expect, it } from "vitest";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { profitCalculationService } from "@/lib/services/profit-calculation-service";
import {
  buildFinanceSummary,
  buildOrderProfitBreakdown,
} from "@/lib/services/profit-breakdown-service";
import { emptyDatabase, product, spool, unit } from "@/tests/helpers";

describe("ProfitCalculationService", () => {
  it("does not require filament cost or count revenue for a cancelled unprinted order", () => {
    const data = emptyDatabase();
    data.products.push(product());
    const work = unit(data);
    const result = orderIngestionService.ingest(work, {
      marketplace: "manual",
      marketplace_order_id: "CANCELLED-NO-PRINT",
      order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    data.orders[0].internal_status = "cancelled";
    profitCalculationService.recalculateOrder(work, result.orderId);

    const breakdown = buildOrderProfitBreakdown(data, data.orders[0]);
    expect(data.orders[0].profit_status).toBe("complete");
    expect(breakdown.income.revenue).toBe(0);
    expect(breakdown.production.total).toBe(0);
  });

  it("does not report profit while product or filament cost is incomplete", () => {
    const data = emptyDatabase();
    const work = unit(data);
    const result = orderIngestionService.ingest(work, {
      marketplace: "yandex",
      marketplace_order_id: "INCOMPLETE",
      marketplace_status: "PROCESSING",
      order_date: "2026-06-07T00:00:00.000Z",
      items: [{ marketplace_sku: "UNKNOWN", quantity: 1, unit_price: 89900 }],
    });
    profitCalculationService.recalculateOrder(work, result.orderId);
    expect(data.orders[0]).toMatchObject({
      problem_code: "SKU_NOT_FOUND",
      profit_status: "incomplete",
      production_cost: 0,
      profit: 0,
      margin_percent: 0,
    });
    expect(data.order_items[0].profit).toBe(0);
  });

  it("uses the public profit formula and never counts sale twice", () => {
    const data = emptyDatabase();
    data.settings.find((item) => item.key === "defaultElectricityCost")!.value = "1000";
    data.products.push(product({ packaging_cost: 2000, extra_cost: 500 }));
    data.filament_spools.push(spool({ price_per_kg: 120000 }));
    const work = unit(data);
    const result = orderIngestionService.ingest(work, {
      marketplace: "manual", marketplace_order_id: "FORMULA", order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    const operations = [
      ["sale", 100000],
      ["compensation", 5000],
      ["return", 10000],
      ["commission", 10000],
      ["logistics", 5000],
      ["acquiring", 1000],
      ["boost", 2000],
      ["storage", 500],
      ["penalty", 300],
      ["other", 200],
    ] as const;
    operations.forEach(([type, amount], index) => data.financial_operations.push({
      id: crypto.randomUUID(), marketplace: "manual", order_id: result.orderId,
      marketplace_order_id: "FORMULA", operation_id: `operation-${index}`,
      operation_date: new Date().toISOString(), type, amount, description: type,
      match_status: "matched", raw_payload: "", created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    profitCalculationService.recalculateOrder(work, result.orderId);
    const breakdown = buildOrderProfitBreakdown(data, data.orders[0]);
    const summary = buildFinanceSummary(data);

    expect(breakdown.income).toMatchObject({
      revenue: 100000,
      saleReconciliation: 100000,
      returns: 10000,
      compensations: 5000,
      adjustedRevenue: 95000,
    });
    expect(breakdown.production.total).toBe(15500);
    expect(breakdown.marketplace.total).toBe(19000);
    expect(breakdown.result).toMatchObject({
      grossProfit: 79500,
      netProfit: 60500,
      profitStatus: "complete",
    });
    expect(data.orders[0]).toMatchObject({
      profit_status: "complete",
      expected_payout: 76000,
      profit: 60500,
    });
    expect(summary.result).toMatchObject({ netProfit: 60500, incompleteOrders: 0 });
    expect(summary.cash).toMatchObject({
      erpForecast: 76000,
      yandexReportedPayments: 0,
      scheduledPayout: 0,
      nextPayoutDate: "",
      scheduledOrders: 0,
    });
  });

  it("does not count Yandex subsidy reconciliation as compensation", () => {
    const data = emptyDatabase();
    data.products.push(product());
    data.filament_spools.push(spool());
    const work = unit(data);
    const result = orderIngestionService.ingest(work, {
      marketplace: "manual", marketplace_order_id: "SUBSIDY",
      order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    data.financial_operations.push({
      id: crypto.randomUUID(), marketplace: "manual", order_id: result.orderId,
      marketplace_order_id: "SUBSIDY", operation_id: "SUBSIDY:subsidy:SUBSIDY",
      operation_date: new Date().toISOString(), type: "sale", amount: 100000,
      description: "Субсидия в составе выручки", match_status: "matched", raw_payload: "",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    profitCalculationService.recalculateOrder(work, result.orderId);
    const breakdown = buildOrderProfitBreakdown(data, data.orders[0]);

    expect(breakdown.income).toMatchObject({
      revenue: 100000,
      compensations: 0,
      adjustedRevenue: 100000,
      saleReconciliation: 100000,
    });
  });

  it("recovers COST_NOT_CALCULATED after a compatible spool appears", () => {
    const data = emptyDatabase();
    data.products.push(product());
    const work = unit(data);
    const result = orderIngestionService.ingest(work, {
      marketplace: "manual", marketplace_order_id: "RECOVER-COST", order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    expect(data.orders[0].profit_status).toBe("incomplete");
    data.orders[0].problem_code = "COST_NOT_CALCULATED";
    data.orders[0].internal_status = "delivered";
    data.filament_spools.push(spool());

    profitCalculationService.recalculateOrder(work, result.orderId);

    expect(data.orders[0]).toMatchObject({
      problem_code: "",
      profit_status: "complete",
    });
    expect(data.order_items[0].spool_id).toBeTruthy();
  });

  it("allocates marketplace costs by revenue and preserves the exact total", () => {
    const data = emptyDatabase();
    data.settings.find((item) => item.key === "defaultPackagingCost")!.value = "2500";
    data.settings.find((item) => item.key === "defaultElectricityCost")!.value = "1000";
    data.products.push(product(), product({ id: crypto.randomUUID(), marketplace_sku: "SKU-2" }));
    data.filament_spools.push(spool());
    const work = unit(data);
    const result = orderIngestionService.ingest(work, {
      marketplace: "manual", marketplace_order_id: "P-1", order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }, { marketplace_sku: "SKU-2", quantity: 1, unit_price: 200000 }],
    });
    data.financial_operations.push({
      id: crypto.randomUUID(), marketplace: "manual", order_id: result.orderId, marketplace_order_id: "P-1",
      operation_id: "fee-1", operation_date: new Date().toISOString(), type: "commission", amount: 10001,
      description: "Комиссия", match_status: "matched", raw_payload: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    profitCalculationService.recalculateOrder(work, result.orderId);
    const items = data.order_items;
    expect(items[0].allocated_marketplace_cost).toBe(3334);
    expect(items[1].allocated_marketplace_cost).toBe(6667);
    expect(items.reduce((sum, item) => sum + item.allocated_marketplace_cost, 0)).toBe(10001);
    expect(items.every((item) => item.packaging_cost === 2500 && item.electricity_cost === 1000)).toBe(true);
    expect(data.orders[0].calculation_state).toBe("actual");
  });
});
