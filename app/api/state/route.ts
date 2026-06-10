import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { getSettings } from "@/lib/services/settings-service";
import { fullSyncService, storage } from "@/lib/storage";
import { orderProblemDetails } from "@/lib/services/order-diagnostics-service";
import {
  buildFinanceSummary,
  buildOrderProfitBreakdown,
} from "@/lib/services/profit-breakdown-service";

export async function GET() {
  try {
    await requireSession();
    const database = await storage.read();
    const productsById = new Map(database.products.map((item) => [item.id, item]));
    const orders = database.orders.map((order) => ({
      ...order,
      items: database.order_items.filter((item) => item.order_id === order.id).map((item) => ({
        ...item,
        product: productsById.get(item.product_id) || null,
        product_match: item.product_id ? "matched" : "missing",
      })),
      operations: database.financial_operations.filter((item) => item.order_id === order.id),
      profit_status: order.profit_status,
      profitBreakdown: buildOrderProfitBreakdown(database, order),
      problemDetails: order.internal_status === "problem"
        ? orderProblemDetails(database, order)
        : [],
    }));
    const printJobs = database.print_jobs.map((job) => ({
      ...job,
      item: database.order_items.find((item) => item.id === job.order_item_id),
      order: database.orders.find((item) => item.id === job.order_id),
      product: productsById.get(database.order_items.find((item) => item.id === job.order_item_id)?.product_id || ""),
      printer: database.printers.find((item) => item.id === job.printer_id),
    }));
    const [latestSync, syncIssues] = await Promise.all([
      fullSyncService.latest(),
      fullSyncService.issues(30),
    ]);
    const latestFilamentSync = [...database.sync_logs].reverse().find(
      (log) => log.source === "google_sheets"
        && log.operation === "sync_google_filament"
        && log.summary,
    );
    let filamentImportReport: Record<string, unknown> = {};
    try {
      filamentImportReport = latestFilamentSync?.summary
        ? JSON.parse(latestFilamentSync.summary)
        : {};
    } catch {
      filamentImportReport = {};
    }
    const workingSpools = database.filament_spools.filter((spool) => spool.status !== "archived");
    const unmatchedItems = database.order_items.filter((item) => !item.product_id);
    const unmatchedByKey = new Map<string, {
      marketplace: string;
      sku: string;
      orderIds: string[];
      names: string[];
      revenue: number;
    }>();
    for (const item of unmatchedItems) {
      const order = database.orders.find((candidate) => candidate.id === item.order_id);
      if (!order) continue;
      const key = `${order.marketplace}:${item.marketplace_sku}`;
      const row = unmatchedByKey.get(key) || {
        marketplace: order.marketplace,
        sku: item.marketplace_sku,
        orderIds: [],
        names: [],
        revenue: 0,
      };
      row.orderIds.push(order.marketplace_order_id);
      if (item.name && !row.names.includes(item.name)) row.names.push(item.name);
      row.revenue += item.revenue;
      unmatchedByKey.set(key, row);
    }
    return NextResponse.json({
      products: database.products,
      spools: database.filament_spools.map((spool) => ({
        ...spool,
        price_per_spool_rub: spool.price_per_spool / 100,
        price_per_kg_rub: spool.price_per_kg / 100,
        price_per_gram_rub: spool.price_per_kg / 100_000,
      })),
      orders,
      printJobs,
      financialOperations: database.financial_operations,
      syncLogs: database.sync_logs.slice(-30).reverse(),
      latestSync,
      syncIssues,
      financeSummary: buildFinanceSummary(database),
      productMatching: {
        matchedItems: database.order_items.length - unmatchedItems.length,
        unmatchedItems: unmatchedItems.length,
        unmatched: [...unmatchedByKey.values()],
      },
      payoutSchedule: database.orders
        .filter((order) => order.payment_status !== "not_available" || order.expected_payout > 0)
        .map((order) => {
          const breakdown = buildOrderProfitBreakdown(database, order);
          const names = database.order_items
            .filter((item) => item.order_id === order.id)
            .map((item) => item.name)
            .filter(Boolean);
          return {
            orderId: order.id,
            marketplaceOrderId: order.marketplace_order_id,
            orderDate: order.order_date,
            names,
            internalStatus: order.internal_status,
            status: order.payment_status,
            calculationDate: order.payment_date,
            payoutDate: order.payout_date,
            paymentOrderId: order.payment_order_id,
            revenue: breakdown.income.revenue,
            marketplaceDeductions: breakdown.marketplace.total,
            forecastAmount: order.expected_payout,
            confirmedAmount: order.actual_payout,
            reportedPaymentAmount: order.reported_payment_amount,
            reportedRefundAmount: order.reported_refund_amount,
            bankScheduled: Boolean(order.payment_order_id && order.payout_date),
          };
        })
        .sort((a, b) => (b.payoutDate || b.calculationDate).localeCompare(a.payoutDate || a.calculationDate)),
      filamentAudit: {
        ...filamentImportReport,
        activeSpools: database.filament_spools.filter((spool) => spool.status === "active").length,
        archivedSpools: database.filament_spools.filter((spool) => spool.status === "archived").length,
        initialWeightGrams: workingSpools.reduce((sum, spool) => sum + spool.initial_weight_grams, 0),
        remainingWeightGrams: workingSpools.reduce((sum, spool) => sum + spool.remaining_weight_grams, 0),
        reservedWeightGrams: workingSpools.reduce((sum, spool) => sum + spool.reserved_weight_grams, 0),
      },
      printers: database.printers.map(({ access_code_encrypted: _, ...printer }) => printer),
      settings: getSettings(database),
    });
  } catch (error) {
    return apiError(error);
  }
}
