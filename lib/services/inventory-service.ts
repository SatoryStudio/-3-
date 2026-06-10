import type { FilamentMovement, FilamentSpool, FilamentUsageSource, OrderStatus } from "@/lib/domain/types";
import type { UnitOfWork } from "@/lib/storage/storage-adapter";
import { profitCalculationService } from "@/lib/services/profit-calculation-service";

const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["waiting_production", "in_production", "problem", "cancelled"],
  waiting_production: ["in_production", "problem", "cancelled"],
  in_production: ["printed", "problem", "cancelled"],
  printed: ["ready_to_ship", "returned"],
  ready_to_ship: ["assembling", "in_transit", "returned"],
  assembling: ["in_transit", "returned"],
  in_transit: ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
  problem: ["waiting_production", "in_production", "cancelled"],
};

function movement(
  unit: UnitOfWork,
  input: Omit<FilamentMovement, "id" | "created_at">,
) {
  unit.data.filament_movements.push({
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...input,
  });
  unit.touch("filament_movements");
}

export class InventoryService {
  addSpool(unit: UnitOfWork, spool: FilamentSpool) {
    if (unit.data.filament_spools.some((item) => item.id === spool.id)) throw new Error("Катушка уже существует");
    if (spool.initial_weight_grams <= 0 || spool.remaining_weight_grams < 0) throw new Error("Некорректный вес катушки");
    unit.data.filament_spools.push(spool);
    movement(unit, {
      spool_id: spool.id, order_id: "", order_item_id: "", print_job_id: "",
      type: "purchase", grams: spool.remaining_weight_grams, comment: "Катушка добавлена из Google Sheets",
    });
    unit.touch("filament_spools", "filament_movements");
    return spool;
  }

  adjustRemaining(unit: UnitOfWork, spoolId: string, nextRemaining: number, comment: string) {
    const spool = unit.data.filament_spools.find((item) => item.id === spoolId);
    const grams = Math.round(nextRemaining);
    if (!spool) throw new Error("Катушка не найдена");
    if (!Number.isFinite(grams) || grams < 0) throw new Error("Остаток не может быть отрицательным");
    if (grams < spool.reserved_weight_grams) throw new Error("Остаток не может быть меньше резерва");
    const delta = grams - spool.remaining_weight_grams;
    if (!delta) return spool;
    spool.remaining_weight_grams = grams;
    spool.status = grams <= 0 ? "empty" : "active";
    spool.updated_at = new Date().toISOString();
    movement(unit, {
      spool_id: spool.id,
      order_id: "",
      order_item_id: "",
      print_job_id: "",
      type: "manual_adjustment",
      grams: delta,
      comment,
    });
    unit.touch("filament_spools", "filament_movements");
    return spool;
  }

  transitionOrder(unit: UnitOfWork, orderId: string, next: OrderStatus) {
    const order = unit.data.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Заказ не найден");
    if (order.internal_status === next) return order;
    if (!ALLOWED_ORDER_TRANSITIONS[order.internal_status].includes(next)) {
      throw new Error(`Недопустимый переход ${order.internal_status} → ${next}`);
    }
    order.internal_status = next;
    order.updated_at = new Date().toISOString();
    unit.touch("orders");
    return order;
  }

  releaseUnstartedMarketplaceOrder(unit: UnitOfWork, orderId: string) {
    const jobs = unit.data.print_jobs.filter((item) => item.order_id === orderId);
    if (jobs.some((job) =>
      ["printing", "success", "failed"].includes(job.status) || Boolean(job.started_at))) {
      return false;
    }
    const now = new Date().toISOString();
    for (const item of unit.data.order_items.filter((candidate) => candidate.order_id === orderId)) {
      if (!item.spool_id || !item.reserved_filament_grams) continue;
      const spool = unit.data.filament_spools.find((candidate) => candidate.id === item.spool_id);
      if (!spool || spool.reserved_weight_grams < item.reserved_filament_grams) {
        throw new Error("Резерв катушки повреждён");
      }
      spool.reserved_weight_grams -= item.reserved_filament_grams;
      spool.updated_at = now;
      movement(unit, {
        spool_id: spool.id,
        order_id: orderId,
        order_item_id: item.id,
        print_job_id: "",
        type: "unreserve",
        grams: item.reserved_filament_grams,
        comment: "Заказ уже передан маркетплейсу",
      });
      item.reserved_filament_grams = 0;
      item.updated_at = now;
    }
    jobs.filter((job) => job.status === "queued").forEach((job) => {
      job.status = "cancelled";
      job.comment = "Отменено: заказ уже передан маркетплейсу";
      job.updated_at = now;
    });
    unit.touch("filament_spools", "order_items", "print_jobs");
    return true;
  }

  markPrinting(unit: UnitOfWork, printJobId: string, printerId = "") {
    const job = unit.data.print_jobs.find((item) => item.id === printJobId);
    if (!job || !["queued", "failed"].includes(job.status)) throw new Error("Задание нельзя начать");
    if (printerId) {
      const printer = unit.data.printers.find((item) => item.id === printerId && item.is_active);
      if (!printer) throw new Error("Активный принтер не найден");
      const busy = unit.data.print_jobs.some((item) =>
        item.id !== printJobId && item.printer_id === printerId && item.status === "printing");
      if (busy) throw new Error("На этом принтере уже идёт печать");
      job.printer_id = printerId;
    }
    job.status = "printing";
    job.started_at = new Date().toISOString();
    job.updated_at = job.started_at;
    const order = unit.data.orders.find((item) => item.id === job.order_id);
    if (order && ["waiting_production", "in_production"].includes(order.internal_status)) order.internal_status = "in_production";
    unit.touch("print_jobs", "orders");
  }

  completePrint(
    unit: UnitOfWork,
    printJobId: string,
    actualGrams?: number,
    usageSource: FilamentUsageSource = "manual",
  ) {
    const job = unit.data.print_jobs.find((item) => item.id === printJobId);
    if (!job || !["queued", "printing", "failed"].includes(job.status)) throw new Error("Задание уже завершено");
    const item = unit.data.order_items.find((candidate) => candidate.id === job.order_item_id);
    const spool = unit.data.filament_spools.find((candidate) => candidate.id === item?.spool_id);
    if (!item || !spool) throw new Error("Для позиции не найден резерв филамента");
    const grams = Math.round(actualGrams || item.planned_filament_grams);
    if (grams <= 0 || grams > spool.remaining_weight_grams) throw new Error("Некорректный фактический расход");
    if (item.reserved_filament_grams > spool.reserved_weight_grams) throw new Error("Резерв катушки повреждён");

    spool.remaining_weight_grams -= grams;
    spool.reserved_weight_grams -= item.reserved_filament_grams;
    spool.status = spool.remaining_weight_grams <= 0 ? "empty" : "active";
    spool.updated_at = new Date().toISOString();
    item.actual_filament_grams = grams;
    item.reserved_filament_grams = 0;
    item.updated_at = spool.updated_at;
    job.status = "success";
    job.actual_grams = grams;
    job.usage_source = actualGrams ? usageSource : "planned";
    job.finished_at = spool.updated_at;
    job.updated_at = spool.updated_at;
    movement(unit, {
      spool_id: spool.id, order_id: item.order_id, order_item_id: item.id, print_job_id: job.id,
      type: "write_off_print", grams, comment: "Успешная печать",
    });

    const remainingJobs = unit.data.print_jobs.filter(
      (candidate) => candidate.order_id === item.order_id && candidate.id !== job.id && candidate.status !== "success",
    );
    const order = unit.data.orders.find((candidate) => candidate.id === item.order_id);
    if (order) order.internal_status = remainingJobs.length ? "in_production" : "printed";
    unit.touch("filament_spools", "order_items", "print_jobs", "orders");
    profitCalculationService.recalculateOrder(unit, item.order_id);
  }

  failPrint(unit: UnitOfWork, printJobId: string, failedGrams: number) {
    const job = unit.data.print_jobs.find((item) => item.id === printJobId);
    if (!job || !["queued", "printing", "failed"].includes(job.status)) throw new Error("Задание нельзя списать в брак");
    const item = unit.data.order_items.find((candidate) => candidate.id === job.order_item_id);
    const spool = unit.data.filament_spools.find((candidate) => candidate.id === item?.spool_id);
    const grams = Math.round(failedGrams);
    if (!item || !spool || grams <= 0 || grams > spool.remaining_weight_grams) throw new Error("Некорректный вес брака");
    spool.remaining_weight_grams -= grams;
    spool.updated_at = new Date().toISOString();
    item.failed_filament_grams += grams;
    item.updated_at = spool.updated_at;
    job.status = "failed";
    job.failed_grams += grams;
    job.updated_at = spool.updated_at;
    const order = unit.data.orders.find((candidate) => candidate.id === item.order_id);
    if (order) order.internal_status = "in_production";
    movement(unit, {
      spool_id: spool.id, order_id: item.order_id, order_item_id: item.id, print_job_id: job.id,
      type: "write_off_failed", grams, comment: "Неудачная печать",
    });
    unit.touch("filament_spools", "order_items", "print_jobs", "orders");
    profitCalculationService.recalculateOrder(unit, item.order_id);
  }

  cancelOrder(unit: UnitOfWork, orderId: string) {
    const order = unit.data.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Заказ не найден");
    for (const item of unit.data.order_items.filter((candidate) => candidate.order_id === orderId)) {
      if (!item.reserved_filament_grams || !item.spool_id) continue;
      const spool = unit.data.filament_spools.find((candidate) => candidate.id === item.spool_id);
      if (!spool) continue;
      spool.reserved_weight_grams -= item.reserved_filament_grams;
      movement(unit, {
        spool_id: spool.id, order_id: orderId, order_item_id: item.id, print_job_id: "",
        type: "unreserve", grams: item.reserved_filament_grams, comment: "Отмена заказа",
      });
      item.reserved_filament_grams = 0;
      item.updated_at = new Date().toISOString();
    }
    order.internal_status = "cancelled";
    order.updated_at = new Date().toISOString();
    unit.data.print_jobs
      .filter((job) => job.order_id === orderId && job.status !== "success")
      .forEach((job) => { job.status = "cancelled"; job.updated_at = order.updated_at; });
    unit.touch("filament_spools", "order_items", "orders", "print_jobs");
  }
}

export const inventoryService = new InventoryService();
