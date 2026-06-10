import {
  normalizeYandexCommissionType,
  yandexItemUnitPrice,
} from "../lib/integrations/yandex-market-adapter";
import { profitCalculationService } from "../lib/services/profit-calculation-service";
import { storage } from "../lib/storage";

function cents(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : 0;
}

function latestDate(values: string[]) {
  return values.filter(Boolean).sort().at(-1) || "";
}

async function main() {
  await storage.read();
  const backup = await storage.createFullBackup();
  const result = await storage.transaction((unit) => {
    let ordersUpdated = 0;
    let itemsUpdated = 0;
    let paymentsCreated = 0;

    for (const order of unit.data.orders.filter((candidate) => candidate.marketplace === "yandex")) {
      let raw: any = {};
      try {
        raw = JSON.parse(order.raw_payload || "{}");
      } catch {
        continue;
      }

      const rawItems = (raw.items || raw.initialItems || []).filter(Boolean);
      for (const item of unit.data.order_items.filter((candidate) => candidate.order_id === order.id)) {
        const source = rawItems.find((candidate: any) =>
          String(candidate.shopSku || candidate.offerId || candidate.offer?.shopSku || "") === item.marketplace_sku);
        if (!source) continue;
        const unitPrice = yandexItemUnitPrice(source);
        if (unitPrice > 0 && (item.unit_price !== unitPrice || item.revenue !== unitPrice * item.quantity)) {
          item.unit_price = unitPrice;
          item.revenue = unitPrice * item.quantity;
          item.updated_at = new Date().toISOString();
          itemsUpdated++;
        }
      }

      const payments = Array.isArray(raw.payments) ? raw.payments : [];
      const paymentRows = payments.filter((payment: any) => payment.type === "PAYMENT");
      const refundRows = payments.filter((payment: any) => payment.type === "REFUND");
      const confirmedPayments = paymentRows.filter((payment: any) => payment.paymentOrder?.id);
      const confirmedRefunds = refundRows.filter((payment: any) => payment.paymentOrder?.id);
      const confirmedNet = confirmedPayments.reduce((sum: number, payment: any) => sum + cents(payment.total), 0)
        - confirmedRefunds.reduce((sum: number, payment: any) => sum + cents(payment.total), 0);

      order.reported_payment_amount = paymentRows.reduce(
        (sum: number, payment: any) => sum + cents(payment.total),
        0,
      );
      order.reported_refund_amount = refundRows.reduce(
        (sum: number, payment: any) => sum + cents(payment.total),
        0,
      );
      order.actual_payout = Math.max(0, confirmedNet);
      order.payment_status = confirmedPayments.length
        ? confirmedNet <= 0 ? "refunded" : "paid"
        : payments.length ? "expected" : "not_available";
      order.payment_date = latestDate(payments.map((payment: any) => String(payment.date || "")));
      order.payout_date = latestDate(payments.map((payment: any) => String(payment.paymentOrder?.date || "")));
      order.payment_order_id = confirmedPayments
        .map((payment: any) => String(payment.paymentOrder?.id || ""))
        .filter(Boolean)
        .join(", ");
      order.updated_at = new Date().toISOString();

      for (const payment of payments) {
        const operationId = `${order.marketplace_order_id}:payment:${payment.id}`;
        const existing = unit.data.financial_operations.find(
          (operation) => operation.marketplace === "yandex" && operation.operation_id === operationId,
        );
        const values = {
          order_id: order.id,
          marketplace_order_id: order.marketplace_order_id,
          operation_date: payment.date || order.order_date,
          type: payment.type === "REFUND" ? "return" as const : "sale" as const,
          amount: cents(payment.total),
          description: payment.type === "REFUND"
            ? "Яндекс Маркет: возврат платежа покупателю"
            : "Яндекс Маркет: расчёт по заказу",
          match_status: "matched" as const,
          updated_at: new Date().toISOString(),
        };
        if (existing) Object.assign(existing, values);
        else {
          unit.data.financial_operations.push({
            id: crypto.randomUUID(),
            marketplace: "yandex",
            operation_id: operationId,
            raw_payload: "",
            created_at: new Date().toISOString(),
            ...values,
          });
          paymentsCreated++;
        }
      }
      ordersUpdated++;
    }

    for (const operation of unit.data.financial_operations) {
      const match = operation.operation_id.match(/:commission:([^:]+)$/);
      if (operation.marketplace === "yandex" && match) {
        operation.type = normalizeYandexCommissionType(match[1]);
      }
    }

    for (const order of unit.data.orders) {
      profitCalculationService.recalculateOrder(unit, order.id);
    }
    unit.touch("orders", "order_items", "financial_operations");
    return { ordersUpdated, itemsUpdated, paymentsCreated };
  });

  console.log(JSON.stringify({ backup: backup.path, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
