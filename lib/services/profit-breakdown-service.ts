import type {
  Database,
  FinancialOperation,
  Order,
  OrderItem,
} from "@/lib/domain/types";

const COST_PROBLEM_CODES = new Set([
  "SKU_NOT_FOUND",
  "PRODUCT_NOT_FOUND",
  "FILAMENT_NOT_FOUND",
  "FILAMENT_NOT_ENOUGH",
  "COST_NOT_CALCULATED",
]);

export function isCostIncomplete(order: Pick<Order, "problem_code" | "profit_status">) {
  return order.profit_status === "incomplete" || COST_PROBLEM_CODES.has(order.problem_code);
}

function total(operations: FinancialOperation[], type: FinancialOperation["type"]) {
  return operations
    .filter((operation) => operation.type === type)
    .reduce((sum, operation) => sum + Math.abs(operation.amount), 0);
}

export function buildOrderProfitBreakdown(
  database: Pick<Database, "order_items" | "financial_operations" | "filament_spools">,
  order: Order,
) {
  const items = database.order_items.filter((item) => item.order_id === order.id);
  const operations = database.financial_operations.filter(
    (operation) => operation.order_id === order.id && operation.match_status === "matched",
  );
  const revenue = order.internal_status === "cancelled"
    ? 0
    : items.reduce((sum, item) => sum + item.revenue, 0);
  const returns = total(operations, "return");
  const compensations = total(operations, "compensation");
  const commission = total(operations, "commission");
  const logistics = total(operations, "logistics");
  const acquiring = total(operations, "acquiring");
  const boost = total(operations, "boost");
  const storage = total(operations, "storage");
  const penalties = total(operations, "penalty");
  const otherMarketplace = total(operations, "other");
  const filamentCost = items.reduce((sum, item) => sum + item.filament_cost, 0);
  const packagingCost = items.reduce((sum, item) => sum + item.packaging_cost, 0);
  const electricityCost = items.reduce((sum, item) => sum + item.electricity_cost, 0);
  const extraCost = items.reduce((sum, item) => sum + item.extra_cost, 0);
  const failedPrintCost = items.reduce((sum, item) => {
    const spool = database.filament_spools.find((candidate) => candidate.id === item.spool_id);
    return sum + (spool
      ? Math.round((item.failed_filament_grams / 1000) * spool.price_per_kg)
      : 0);
  }, 0);
  const adjustedRevenue = revenue + compensations - returns;
  const productionCost = filamentCost + packagingCost + electricityCost + failedPrintCost + extraCost;
  const marketplaceDeductions = commission + logistics + acquiring + boost + storage + penalties + otherMarketplace;
  const grossProfit = adjustedRevenue - productionCost;
  const netProfit = grossProfit - marketplaceDeductions;
  return {
    income: {
      revenue,
      returns,
      compensations,
      adjustedRevenue,
      saleReconciliation: total(operations, "sale"),
    },
    marketplace: {
      commission,
      logistics,
      acquiring,
      boost,
      storage,
      penalties,
      other: otherMarketplace,
      total: marketplaceDeductions,
    },
    production: {
      plannedGrams: items.reduce((sum, item) => sum + item.planned_filament_grams, 0),
      actualGrams: items.reduce((sum, item) => sum + item.actual_filament_grams, 0),
      failedGrams: items.reduce((sum, item) => sum + item.failed_filament_grams, 0),
      filamentCost,
      packagingCost,
      electricityCost,
      failedPrintCost,
      extraCost,
      total: productionCost,
    },
    result: {
      grossProfit,
      netProfit,
      marginPercent: adjustedRevenue
        ? Math.round((netProfit / adjustedRevenue) * 10_000) / 100
        : 0,
      profitStatus: isCostIncomplete(order) ? "incomplete" as const : "complete" as const,
    },
  };
}

export function allocateByRevenue(totalValue: number, items: OrderItem[]) {
  if (!items.length) return [];
  const revenue = items.reduce((sum, item) => sum + item.revenue, 0);
  let allocated = 0;
  return items.map((item, index) => {
    if (index === items.length - 1) return totalValue - allocated;
    const value = revenue > 0
      ? Math.round(totalValue * (item.revenue / revenue))
      : Math.round(totalValue / items.length);
    allocated += value;
    return value;
  });
}

export function buildFinanceSummary(database: Database) {
  const breakdowns = database.orders.map((order) => ({
    order,
    breakdown: buildOrderProfitBreakdown(database, order),
  }));
  const complete = breakdowns.filter(({ breakdown }) =>
    breakdown.result.profitStatus === "complete");
  const earned = complete.filter(({ order }) => order.internal_status === "delivered");
  const activeForPayout = breakdowns.filter(({ order }) =>
    !["cancelled", "returned"].includes(order.internal_status));
  const ordersWithBankPayout = breakdowns.filter(({ order }) =>
    Boolean(order.payment_order_id && order.payout_date));
  const payoutDates = ordersWithBankPayout
    .map(({ order }) => order.payout_date)
    .filter(Boolean)
    .sort();
  const sum = (rows: typeof breakdowns, read: (value: ReturnType<typeof buildOrderProfitBreakdown>) => number) =>
    rows.reduce((totalValue, row) => totalValue + read(row.breakdown), 0);
  return {
    income: {
      revenue: sum(breakdowns, (value) => value.income.revenue),
      returns: sum(breakdowns, (value) => value.income.returns),
      compensations: sum(breakdowns, (value) => value.income.compensations),
      adjustedRevenue: sum(breakdowns, (value) => value.income.adjustedRevenue),
    },
    marketplace: {
      commission: sum(breakdowns, (value) => value.marketplace.commission),
      logistics: sum(breakdowns, (value) => value.marketplace.logistics),
      acquiring: sum(breakdowns, (value) => value.marketplace.acquiring),
      boost: sum(breakdowns, (value) => value.marketplace.boost),
      storage: sum(breakdowns, (value) => value.marketplace.storage),
      penalties: sum(breakdowns, (value) => value.marketplace.penalties),
      other: sum(breakdowns, (value) => value.marketplace.other),
      total: sum(breakdowns, (value) => value.marketplace.total),
    },
    production: {
      filamentCost: sum(complete, (value) => value.production.filamentCost),
      packagingCost: sum(complete, (value) => value.production.packagingCost),
      electricityCost: sum(complete, (value) => value.production.electricityCost),
      failedPrintCost: sum(complete, (value) => value.production.failedPrintCost),
      extraCost: sum(complete, (value) => value.production.extraCost),
      total: sum(complete, (value) => value.production.total),
    },
    result: {
      grossProfit: sum(complete, (value) => value.result.grossProfit),
      netProfit: sum(complete, (value) => value.result.netProfit),
      earnedGrossProfit: sum(earned, (value) => value.result.grossProfit),
      earnedNetProfit: sum(earned, (value) => value.result.netProfit),
      incompleteOrders: breakdowns.length - complete.length,
      completeOrders: complete.length,
    },
    cash: {
      activeOrderValue: sum(activeForPayout, (value) => value.income.revenue),
      deliveredRevenue: sum(earned, (value) => value.income.adjustedRevenue),
      erpForecast: activeForPayout.reduce((totalValue, row) =>
        totalValue + row.order.expected_payout, 0),
      yandexReportedPayments: breakdowns.reduce((totalValue, row) =>
        totalValue + row.order.reported_payment_amount - row.order.reported_refund_amount, 0),
      scheduledPayout: ordersWithBankPayout.reduce((totalValue, row) =>
        totalValue + row.order.actual_payout, 0),
      nextPayoutDate: payoutDates[0] || "",
      scheduledOrders: ordersWithBankPayout.length,
      calculationOrders: breakdowns.filter(({ order }) =>
        order.reported_payment_amount > 0 || order.reported_refund_amount > 0).length,
      expectedPayout: activeForPayout.reduce((totalValue, row) =>
        totalValue + row.order.expected_payout, 0),
      confirmedPayout: breakdowns.reduce((totalValue, row) =>
        totalValue + row.order.actual_payout, 0),
      awaitingBankConfirmation: breakdowns.filter(({ order }) =>
        order.payment_status === "expected").length,
      paidOrders: breakdowns.filter(({ order }) => order.payment_status === "paid").length,
    },
  };
}
