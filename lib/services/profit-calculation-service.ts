import type { Database } from "@/lib/domain/types";
import type { UnitOfWork } from "@/lib/storage/storage-adapter";
import { getSettings } from "@/lib/services/settings-service";
import {
  allocateByRevenue,
  buildOrderProfitBreakdown,
} from "@/lib/services/profit-breakdown-service";
import { filamentMatches } from "@/lib/services/filament-normalization";

export class ProfitCalculationService {
  recalculateOrder(unit: UnitOfWork, orderId: string) {
    const order = unit.data.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Заказ не найден");
    const items = unit.data.order_items.filter((item) => item.order_id === orderId);
    const operations = unit.data.financial_operations.filter(
      (item) => item.order_id === orderId && item.match_status === "matched",
    );
    const settings = getSettings(unit.data);
    items.forEach((item) => {
      if (item.spool_id || !item.product_id) return;
      const product = unit.data.products.find((candidate) => candidate.id === item.product_id);
      const costSpool = product
        ? unit.data.filament_spools
            .filter((candidate) => candidate.status !== "archived"
              && filamentMatches(
                product.filament_material,
                product.filament_color,
                candidate.material,
                candidate.color,
              ))
            .sort((a, b) =>
              a.purchase_date.localeCompare(b.purchase_date)
              || a.created_at.localeCompare(b.created_at))[0]
        : undefined;
      if (costSpool) item.spool_id = costSpool.id;
    });
    const noProductionRequired = order.internal_status === "cancelled"
      && items.every((item) => !item.actual_filament_grams && !item.failed_filament_grams);
    const missingCostSource = !noProductionRequired
      && items.some((item) => !item.product_id || !item.spool_id);
    if (!missingCostSource && order.problem_code === "COST_NOT_CALCULATED") {
      order.problem_code = "";
      order.problem_message = "";
    }

    const marketplaceCosts = operations
      .filter((operation) => [
        "commission", "logistics", "acquiring", "boost", "storage", "penalty", "other",
      ].includes(operation.type))
      .reduce((sum, operation) => sum + Math.abs(operation.amount), 0);
    const allocations = allocateByRevenue(marketplaceCosts, items);
    const returnAllocations = allocateByRevenue(
      operations.filter((operation) => operation.type === "return")
        .reduce((sum, operation) => sum + Math.abs(operation.amount), 0),
      items,
    );
    const compensationAllocations = allocateByRevenue(
      operations.filter((operation) => operation.type === "compensation")
        .reduce((sum, operation) => sum + Math.abs(operation.amount), 0),
      items,
    );
    const incomplete = !noProductionRequired && (
      ["SKU_NOT_FOUND", "PRODUCT_NOT_FOUND", "FILAMENT_NOT_FOUND", "FILAMENT_NOT_ENOUGH", "COST_NOT_CALCULATED"]
        .includes(order.problem_code)
      || missingCostSource
    );
    if (noProductionRequired) {
      order.problem_code = "";
      order.problem_message = "";
    }
    const grossRevenue = items.reduce((sum, item) => sum + item.revenue, 0);
    const returns = operations.filter((operation) => operation.type === "return")
      .reduce((sum, operation) => sum + Math.abs(operation.amount), 0);
    const compensations = operations.filter((operation) => operation.type === "compensation")
      .reduce((sum, operation) => sum + Math.abs(operation.amount), 0);
    const adjustedRevenue = grossRevenue + compensations - returns;
    const payoutEligible = !["cancelled", "returned"].includes(order.internal_status);

    if (incomplete) {
      if (!order.problem_code) order.problem_code = "COST_NOT_CALCULATED";
      order.profit_status = "incomplete";
      items.forEach((item, index) => {
        item.filament_cost = 0;
        item.packaging_cost = 0;
        item.electricity_cost = 0;
        item.extra_cost = 0;
        item.production_cost = 0;
        item.allocated_marketplace_cost = allocations[index] || 0;
        item.profit = 0;
        item.margin_percent = 0;
        item.updated_at = new Date().toISOString();
      });
      order.gross_revenue = grossRevenue;
      order.marketplace_cost = marketplaceCosts;
      order.production_cost = 0;
      order.expected_payout = payoutEligible ? Math.max(0, adjustedRevenue - marketplaceCosts) : 0;
      order.profit = 0;
      order.margin_percent = 0;
      order.calculation_state = "estimated";
      order.updated_at = new Date().toISOString();
      unit.touch("orders", "order_items");
      return order;
    }

    order.profit_status = "complete";
    items.forEach((item, index) => {
      const product = unit.data.products.find((candidate) => candidate.id === item.product_id);
      const spool = unit.data.filament_spools.find((candidate) => candidate.id === item.spool_id);
      const grams = item.actual_filament_grams || item.planned_filament_grams;
      item.filament_cost = noProductionRequired ? 0
        : spool ? Math.round((grams / 1000) * spool.price_per_kg) : 0;
      item.packaging_cost = noProductionRequired ? 0
        : product ? product.packaging_cost || settings.defaultPackagingCost : 0;
      item.electricity_cost = noProductionRequired ? 0 : product ? settings.defaultElectricityCost : 0;
      item.extra_cost = noProductionRequired ? 0 : product?.extra_cost || 0;
      const failedCost = noProductionRequired ? 0
        : spool ? Math.round((item.failed_filament_grams / 1000) * spool.price_per_kg) : 0;
      item.production_cost = item.filament_cost + item.packaging_cost + item.electricity_cost + item.extra_cost + failedCost;
      item.allocated_marketplace_cost = allocations[index] || 0;
      const adjustedRevenue = (order.internal_status === "cancelled" ? 0 : item.revenue)
        + (compensationAllocations[index] || 0)
        - (returnAllocations[index] || 0);
      item.profit = adjustedRevenue - item.production_cost - item.allocated_marketplace_cost;
      item.margin_percent = adjustedRevenue
        ? Math.round((item.profit / adjustedRevenue) * 10_000) / 100
        : 0;
      item.updated_at = new Date().toISOString();
    });

    const breakdown = buildOrderProfitBreakdown(unit.data, order);
    const productionCost = breakdown.production.total;
    const hasFinance = operations.length > 0;
    order.gross_revenue = grossRevenue;
    order.marketplace_cost = breakdown.marketplace.total;
    order.production_cost = productionCost;
    order.expected_payout = payoutEligible && hasFinance
      ? Math.max(0, breakdown.income.adjustedRevenue - breakdown.marketplace.total)
      : payoutEligible ? grossRevenue : 0;
    order.profit = breakdown.result.netProfit;
    order.margin_percent = breakdown.result.marginPercent;
    order.calculation_state = hasFinance ? "actual" : "estimated";
    order.updated_at = new Date().toISOString();
    unit.touch("orders", "order_items");
    return order;
  }

  recalculateAll(database: Database) {
    return database.orders.map((order) => order.id);
  }
}

export const profitCalculationService = new ProfitCalculationService();
