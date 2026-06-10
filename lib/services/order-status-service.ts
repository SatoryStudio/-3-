import type { Order, OrderStatus } from "@/lib/domain/types";
import type { UnitOfWork } from "@/lib/storage/storage-adapter";

const READY = new Set(["READY_TO_SHIP", "READY_FOR_SHIPMENT"]);
const ASSEMBLING = new Set(["ASSEMBLING", "PICKING", "SORTING"]);
const TRANSIT = new Set(["DELIVERY", "PICKUP", "IN_TRANSIT", "SHIPPED"]);
const DELIVERED = new Set(["DELIVERED"]);
const CANCELLED = new Set(["CANCELLED", "CANCELLED_BEFORE_PROCESSING"]);
const RETURNED = new Set(["RETURNED", "PARTIALLY_RETURNED"]);

function values(order: Pick<Order, "marketplace_status" | "marketplace_substatus">) {
  return [order.marketplace_status, order.marketplace_substatus].flatMap((value) => {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized ? [normalized, ...normalized.split(/[\s:/]+/)] : [];
  });
}

export function marketplaceLifecycleStatus(
  order: Pick<Order, "marketplace_status" | "marketplace_substatus">,
): OrderStatus | undefined {
  const statuses = values(order);
  if (statuses.some((value) => value.startsWith("CANCELLED"))) return "cancelled";
  if (statuses.some((value) => value.startsWith("RETURNED") || value.includes("RETURN"))) return "returned";
  if (statuses.some((value) => RETURNED.has(value))) return "returned";
  if (statuses.some((value) => CANCELLED.has(value))) return "cancelled";
  if (statuses.some((value) => DELIVERED.has(value))) return "delivered";
  if (statuses.some((value) => TRANSIT.has(value))) return "in_transit";
  if (statuses.some((value) => READY.has(value))) return "ready_to_ship";
  if (statuses.some((value) => ASSEMBLING.has(value))) return "assembling";
  return undefined;
}

export function refreshOrderLifecycle(unit: UnitOfWork, order: Order) {
  const marketplace = marketplaceLifecycleStatus(order);
  if (marketplace === "cancelled") {
    order.internal_status = "cancelled";
    return order.internal_status;
  }
  if (order.internal_status === "problem") return order.internal_status;
  if (marketplace) {
    order.internal_status = marketplace;
    return order.internal_status;
  }
  const jobs = unit.data.print_jobs.filter((job) => job.order_id === order.id);
  const printed = jobs.length > 0 && jobs.every((job) => job.status === "success");
  const productionStarted = jobs.some(
    (job) => ["printing", "failed"].includes(job.status) || Boolean(job.started_at),
  );
  if (productionStarted) {
    order.internal_status = "in_production";
  } else if (printed) order.internal_status = "printed";
  else if (jobs.some((job) => job.status === "queued")
    || unit.data.order_items.some((item) =>
      item.order_id === order.id && (item.product_id || item.reserved_filament_grams > 0))) {
    order.internal_status = "waiting_production";
  } else order.internal_status = "new";
  return order.internal_status;
}
