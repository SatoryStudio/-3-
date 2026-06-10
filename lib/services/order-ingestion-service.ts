import type {
  IncomingOrder,
  Order,
  OrderItem,
  PrintJob,
  Product,
  SyncProblemCode,
  SyncTechnicalErrorCode,
} from "@/lib/domain/types";
import { profitCalculationService } from "@/lib/services/profit-calculation-service";
import {
  filamentMatches,
  normalizeFilamentColor,
  normalizeFilamentMaterial,
} from "@/lib/services/filament-normalization";
import { inventoryService } from "@/lib/services/inventory-service";
import {
  marketplaceLifecycleStatus,
  refreshOrderLifecycle,
} from "@/lib/services/order-status-service";
import type { UnitOfWork } from "@/lib/storage/storage-adapter";

export interface OrderIngestionResult {
  outcome: "created" | "updated" | "problem" | "production_locked";
  orderId: string;
  problemCode?: SyncProblemCode;
  problemMessage?: string;
  sku?: string;
}

export class OrderIngestionError extends Error {
  constructor(
    public readonly code: SyncTechnicalErrorCode,
    message: string,
    public readonly orderId = "",
    public readonly sku = "",
  ) {
    super(message);
  }
}

type PreparedItem = {
  item: OrderItem;
  product?: Product;
};

export class OrderIngestionService {
  updateMarketplaceState(unit: UnitOfWork, incoming: IncomingOrder): OrderIngestionResult {
    const order = unit.data.orders.find(
      (candidate) => candidate.marketplace === incoming.marketplace
        && candidate.marketplace_order_id === incoming.marketplace_order_id.trim(),
    );
    if (!order) return this.ingest(unit, incoming);
    const now = new Date().toISOString();
    order.marketplace_status = incoming.marketplace_status || order.marketplace_status;
    order.marketplace_substatus = incoming.marketplace_substatus || order.marketplace_substatus;
    order.shipment_date = incoming.shipment_date || order.shipment_date;
    order.delivery_date = incoming.delivery_date || order.delivery_date;
    order.reported_payment_amount = incoming.reported_payment_amount ?? order.reported_payment_amount;
    order.reported_refund_amount = incoming.reported_refund_amount ?? order.reported_refund_amount;
    order.actual_payout = incoming.confirmed_payout_amount ?? order.actual_payout;
    order.payment_status = incoming.payment_status || order.payment_status;
    order.payment_date = incoming.payment_date || order.payment_date;
    order.payout_date = incoming.payout_date || order.payout_date;
    order.payment_order_id = incoming.payment_order_id || order.payment_order_id;
    order.raw_payload = incoming.raw_payload ? JSON.stringify(incoming.raw_payload) : order.raw_payload;
    order.updated_at = now;
    const marketplaceStatus = marketplaceLifecycleStatus(order);
    if (marketplaceStatus && [
      "ready_to_ship", "assembling", "in_transit", "delivered", "cancelled", "returned",
    ].includes(marketplaceStatus)) {
      inventoryService.releaseUnstartedMarketplaceOrder(unit, order.id);
    }
    refreshOrderLifecycle(unit, order);
    profitCalculationService.recalculateOrder(unit, order.id);
    unit.touch("orders", "order_items", "filament_spools", "filament_movements", "print_jobs");
    return { outcome: "updated", orderId: order.id };
  }

  ingest(unit: UnitOfWork, incoming: IncomingOrder): OrderIngestionResult {
    this.validateIncoming(incoming);
    const now = new Date().toISOString();
    const existing = unit.data.orders.find(
      (order) => order.marketplace === incoming.marketplace
        && order.marketplace_order_id === incoming.marketplace_order_id.trim(),
    );

    if (existing && this.productionStarted(unit, existing.id)) {
      const changed = this.itemsChanged(unit, existing.id, incoming);
      this.updateHeader(existing, incoming, now);
      refreshOrderLifecycle(unit, existing);
      profitCalculationService.recalculateOrder(unit, existing.id);
      return { outcome: changed ? "production_locked" : "updated", orderId: existing.id };
    }
    if (existing && !["problem", "new", "waiting_production"].includes(existing.internal_status) && !this.itemsChanged(unit, existing.id, incoming)) {
      this.updateHeader(existing, incoming, now);
      refreshOrderLifecycle(unit, existing);
      profitCalculationService.recalculateOrder(unit, existing.id);
      return { outcome: "updated", orderId: existing.id };
    }

    const order = existing || this.createOrder(incoming, now);
    if (existing) this.releaseForRebuild(unit, existing.id, now);
    this.updateHeader(order, incoming, now);

    const prepared = incoming.items.map((source) => this.prepareItem(unit, order, source, now));
    const missing = prepared.find((entry) => !entry.product);
    let problem: { code: SyncProblemCode; message: string; sku: string } | undefined;
    if (missing) {
      problem = {
        code: "SKU_NOT_FOUND",
        message: `Не найден товар по SKU: ${missing.item.marketplace_sku}`,
        sku: missing.item.marketplace_sku,
      };
    } else if (!order.historical) {
      problem = this.reserveAll(unit, order, prepared, now);
    }

    if (problem) {
      order.internal_status = "problem";
      order.problem_code = problem.code;
      order.problem_message = problem.message;
    } else {
      order.problem_code = "";
      order.problem_message = "";
      if (order.historical) {
        order.internal_status = "new";
        order.internal_status = refreshOrderLifecycle(unit, order) || "delivered";
      } else {
        order.internal_status = "waiting_production";
      }
      if (!order.historical) this.createPrintJobs(unit, order, prepared.map((entry) => entry.item), now);
    }

    if (!existing) unit.data.orders.push(order);
    unit.data.order_items.push(...prepared.map((entry) => entry.item));
    unit.touch("orders", "order_items", "filament_spools", "filament_movements", "print_jobs");
    profitCalculationService.recalculateOrder(unit, order.id);

    if (problem) {
      return {
        outcome: "problem",
        orderId: order.id,
        problemCode: problem.code,
        problemMessage: problem.message,
        sku: problem.sku,
      };
    }
    return { outcome: existing ? "updated" : "created", orderId: order.id };
  }

  private validateIncoming(incoming: IncomingOrder) {
    if (!incoming.marketplace_order_id?.trim()) {
      throw new OrderIngestionError("INVALID_ORDER_FORMAT", "Не указан номер заказа");
    }
    if (!Array.isArray(incoming.items) || !incoming.items.length) {
      throw new OrderIngestionError(
        "INVALID_ORDER_FORMAT",
        "Заказ должен содержать хотя бы одну позицию",
        incoming.marketplace_order_id,
      );
    }
    for (const item of incoming.items) {
      if (!String(item.marketplace_sku || "").trim()) {
        throw new OrderIngestionError(
          "INVALID_ORDER_FORMAT",
          "В позиции заказа отсутствует SKU",
          incoming.marketplace_order_id,
        );
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0) {
        throw new OrderIngestionError(
          "VALIDATION_ERROR",
          `Некорректная позиция ${item.marketplace_sku}`,
          incoming.marketplace_order_id,
          item.marketplace_sku,
        );
      }
    }
  }

  private createOrder(incoming: IncomingOrder, now: string): Order {
    return {
      id: crypto.randomUUID(),
      marketplace: incoming.marketplace,
      marketplace_order_id: incoming.marketplace_order_id.trim(),
      marketplace_status: incoming.marketplace_status || "",
      marketplace_substatus: incoming.marketplace_substatus || "",
      internal_status: incoming.historical ? "delivered" : "new",
      order_date: incoming.order_date || now,
      shipment_date: incoming.shipment_date || "",
      delivery_date: incoming.delivery_date || "",
      historical: Boolean(incoming.historical),
      gross_revenue: 0,
      expected_payout: 0,
      actual_payout: 0,
      reported_payment_amount: 0,
      reported_refund_amount: 0,
      payment_status: "not_available",
      payment_date: "",
      payout_date: "",
      payment_order_id: "",
      marketplace_cost: 0,
      production_cost: 0,
      profit: 0,
      margin_percent: 0,
      calculation_state: "estimated",
      profit_status: "complete",
      problem_code: "",
      problem_message: "",
      raw_payload: "",
      created_at: now,
      updated_at: now,
    };
  }

  private updateHeader(order: Order, incoming: IncomingOrder, now: string) {
    order.marketplace_status = incoming.marketplace_status || order.marketplace_status;
    order.marketplace_substatus = incoming.marketplace_substatus || order.marketplace_substatus;
    const incomingHasTime = String(incoming.order_date || "").includes("T");
    const storedHasTime = String(order.order_date || "").includes("T");
    if (incoming.order_date && (incomingHasTime || !storedHasTime)) {
      order.order_date = incoming.order_date;
    }
    order.shipment_date = incoming.shipment_date || order.shipment_date;
    order.delivery_date = incoming.delivery_date || order.delivery_date;
    order.reported_payment_amount = incoming.reported_payment_amount ?? order.reported_payment_amount;
    order.reported_refund_amount = incoming.reported_refund_amount ?? order.reported_refund_amount;
    order.actual_payout = incoming.confirmed_payout_amount ?? order.actual_payout;
    order.payment_status = incoming.payment_status || order.payment_status;
    order.payment_date = incoming.payment_date || order.payment_date;
    order.payout_date = incoming.payout_date || order.payout_date;
    order.payment_order_id = incoming.payment_order_id || order.payment_order_id;
    order.historical = Boolean(incoming.historical);
    order.raw_payload = incoming.raw_payload ? JSON.stringify(incoming.raw_payload) : order.raw_payload;
    order.updated_at = now;
  }

  private prepareItem(
    unit: UnitOfWork,
    order: Order,
    source: IncomingOrder["items"][number],
    now: string,
  ): PreparedItem {
    const sku = String(source.marketplace_sku).trim();
    const product = unit.data.products.find(
      (candidate) => candidate.is_active
        && candidate.marketplace === order.marketplace
        && candidate.marketplace_sku === sku,
    );
    const quantity = Math.round(source.quantity);
    return {
      product,
      item: {
        id: crypto.randomUUID(),
        order_id: order.id,
        product_id: product?.id || "",
        marketplace_sku: sku,
        name: source.name || product?.name || sku,
        quantity,
        unit_price: Math.round(source.unit_price),
        revenue: Math.round(source.unit_price) * quantity,
        planned_filament_grams: product ? product.weight_grams * quantity : 0,
        reserved_filament_grams: 0,
        actual_filament_grams: 0,
        failed_filament_grams: 0,
        spool_id: "",
        filament_cost: 0,
        packaging_cost: 0,
        electricity_cost: 0,
        extra_cost: 0,
        production_cost: 0,
        allocated_marketplace_cost: 0,
        profit: 0,
        margin_percent: 0,
        created_at: now,
        updated_at: now,
      },
    };
  }

  private reserveAll(
    unit: UnitOfWork,
    order: Order,
    prepared: PreparedItem[],
    now: string,
  ): { code: SyncProblemCode; message: string; sku: string } | undefined {
    const provisional: { item: OrderItem; spoolId: string; grams: number }[] = [];
    for (const { item, product } of prepared) {
      if (!product) continue;
      const compatible = unit.data.filament_spools
        .filter((spool) => spool.status === "active"
          && filamentMatches(
            product.filament_material,
            product.filament_color,
            spool.material,
            spool.color,
          ))
        .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date) || a.created_at.localeCompare(b.created_at));
      const spool = compatible.find(
        (candidate) => candidate.remaining_weight_grams - candidate.reserved_weight_grams >= item.planned_filament_grams,
      );
      if (!spool) {
        this.rollbackProvisional(unit, provisional);
        return compatible.length
          ? {
              code: "FILAMENT_NOT_ENOUGH",
              message: `Недостаточно филамента ${product.filament_material} ${product.filament_color} для SKU ${item.marketplace_sku}`,
              sku: item.marketplace_sku,
            }
          : {
              code: "FILAMENT_NOT_FOUND",
              message: this.filamentNotFoundMessage(unit, product, item.marketplace_sku),
              sku: item.marketplace_sku,
            };
      }
      spool.reserved_weight_grams += item.planned_filament_grams;
      spool.updated_at = now;
      provisional.push({ item, spoolId: spool.id, grams: item.planned_filament_grams });
    }
    provisional.forEach(({ item, spoolId, grams }) => {
      item.spool_id = spoolId;
      item.reserved_filament_grams = grams;
      unit.data.filament_movements.push({
        id: crypto.randomUUID(),
        spool_id: spoolId,
        order_id: order.id,
        order_item_id: item.id,
        print_job_id: "",
        type: "reserve",
        grams,
        comment: "Автоматический резерв",
        created_at: now,
      });
    });
    return undefined;
  }

  private filamentNotFoundMessage(unit: UnitOfWork, product: Product, sku: string) {
    const active = unit.data.filament_spools.filter((spool) => spool.status === "active");
    const materials = [...new Set(active.map((spool) => spool.material).filter(Boolean))].sort();
    const sameMaterialColors = [...new Set(active
      .filter((spool) =>
        normalizeFilamentMaterial(spool.material) === normalizeFilamentMaterial(product.filament_material))
      .map((spool) => spool.color)
      .filter(Boolean))].sort();
    return [
      `Не найдена катушка ${product.filament_material} ${product.filament_color} для SKU ${sku}.`,
      `Требуется: материал «${product.filament_material}», цвет «${product.filament_color}».`,
      `Найдены материалы: ${materials.join(", ") || "нет"}.`,
      `Цвета для совместимого материала: ${sameMaterialColors.join(", ") || "нет"}.`,
    ].join(" ");
  }

  private rollbackProvisional(unit: UnitOfWork, provisional: { spoolId: string; grams: number }[]) {
    for (const entry of provisional) {
      const spool = unit.data.filament_spools.find((candidate) => candidate.id === entry.spoolId);
      if (spool) spool.reserved_weight_grams -= entry.grams;
    }
  }

  private createPrintJobs(unit: UnitOfWork, order: Order, items: OrderItem[], now: string) {
    for (const item of items) {
      const job: PrintJob = {
        id: crypto.randomUUID(),
        order_id: order.id,
        order_item_id: item.id,
        printer_id: "",
        status: "queued",
        planned_grams: item.planned_filament_grams,
        actual_grams: 0,
        failed_grams: 0,
        usage_source: "planned",
        started_at: "",
        finished_at: "",
        comment: "",
        created_at: now,
        updated_at: now,
      };
      unit.data.print_jobs.push(job);
    }
  }

  private productionStarted(unit: UnitOfWork, orderId: string) {
    return unit.data.print_jobs.some(
      (job) => job.order_id === orderId
        && (["printing", "success", "failed"].includes(job.status) || Boolean(job.started_at)),
    );
  }

  private itemsChanged(unit: UnitOfWork, orderId: string, incoming: IncomingOrder) {
    const stored = unit.data.order_items
      .filter((item) => item.order_id === orderId)
      .map((item) => `${item.marketplace_sku}:${item.quantity}:${item.unit_price}`)
      .sort();
    const received = incoming.items
      .map((item) => `${String(item.marketplace_sku).trim()}:${Math.round(item.quantity)}:${Math.round(item.unit_price)}`)
      .sort();
    return JSON.stringify(stored) !== JSON.stringify(received);
  }

  private releaseForRebuild(unit: UnitOfWork, orderId: string, now: string) {
    const items = unit.data.order_items.filter((item) => item.order_id === orderId);
    for (const item of items) {
      if (!item.spool_id || !item.reserved_filament_grams) continue;
      const spool = unit.data.filament_spools.find((candidate) => candidate.id === item.spool_id);
      if (!spool || spool.reserved_weight_grams < item.reserved_filament_grams) {
        throw new OrderIngestionError("STORAGE_ERROR", "Резерв катушки повреждён", orderId, item.marketplace_sku);
      }
      spool.reserved_weight_grams -= item.reserved_filament_grams;
      spool.updated_at = now;
      unit.data.filament_movements.push({
        id: crypto.randomUUID(),
        spool_id: spool.id,
        order_id: orderId,
        order_item_id: item.id,
        print_job_id: "",
        type: "unreserve",
        grams: item.reserved_filament_grams,
        comment: "Пересборка заказа после синхронизации",
        created_at: now,
      });
    }
    unit.data.print_jobs = unit.data.print_jobs.filter(
      (job) => job.order_id !== orderId || job.status !== "queued",
    );
    unit.data.order_items = unit.data.order_items.filter((item) => item.order_id !== orderId);
  }
}

export const orderIngestionService = new OrderIngestionService();
