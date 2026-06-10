import type { IncomingOrder } from "@/lib/domain/types";
import { MarketplaceApiError } from "@/lib/integrations/integration-error";
import type { MarketplaceAdapter, NormalizedFinancialOperation, SyncPeriod } from "@/lib/integrations/marketplace-adapter";
import type { YandexCredentials } from "@/lib/services/integration-settings-service";

type YandexOrder = Record<string, any>;

const COMPLETED = new Set(["DELIVERED", "CANCELLED", "CANCELLED_BEFORE_PROCESSING", "PARTIALLY_RETURNED", "RETURNED"]);

function cents(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : 0;
}

function dateOnly(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function latestDate(values: string[]) {
  return values.filter(Boolean).sort().at(-1) || "";
}

export function yandexItemUnitPrice(item: any) {
  const quantity = Math.max(1, Number(item.count || item.quantity || 1));
  if (Array.isArray(item.prices)) {
    const totalValue = item.prices.reduce(
      (sum: number, price: any) => sum + Number(price?.total || 0),
      0,
    );
    if (Number.isFinite(totalValue) && totalValue > 0) {
      return cents(totalValue / quantity);
    }
  }
  const structuredPrices = item.prices && !Array.isArray(item.prices) ? item.prices : {};
  const structuredValue = Number(structuredPrices.payment?.value || 0)
    + Number(structuredPrices.subsidy?.value || 0);
  if (structuredValue > 0) return cents(structuredValue / quantity);
  return cents(
    item.price
    || item.buyerPrice
    || structuredPrices.buyerPrice
    || item.payment?.value
    || 0,
  );
}

export function normalizeYandexCommissionType(type: string): NormalizedFinancialOperation["type"] {
  const normalized = String(type || "").toUpperCase();
  if (["AUCTION_PROMOTION", "LOYALTY_PARTICIPATION_FEE", "PROMOTION"].includes(normalized)) return "boost";
  if (["DELIVERY_TO_CUSTOMER", "EXPRESS_DELIVERY_TO_CUSTOMER", "CROSSREGIONAL_DELIVERY", "INTAKE_SORTING"].includes(normalized)) return "logistics";
  if (["ACQUIRING", "AGENCY", "PAYMENT_PROCESSING", "PAYMENT_TRANSFER"].includes(normalized)) return "acquiring";
  if (["STORAGE", "WAREHOUSE_STORAGE", "STORAGE_SERVICE", "RETURNED_ORDERS_STORAGE"].includes(normalized)) return "storage";
  if (["SORTING", "RETURN_PROCESSING", "FULFILLMENT", "FULFILLMENT_WITHDRAW"].includes(normalized)) return "logistics";
  if (["RETURN", "RETURN_DELIVERY", "REFUND"].includes(normalized)) return "return";
  if (["PENALTY", "FINE"].includes(normalized)) return "penalty";
  if (normalized === "FEE" || normalized.includes("COMMISSION")) return "commission";
  return "other";
}

export class YandexMarketAdapter implements MarketplaceAdapter {
  private readonly baseUrl = "https://api.partner.market.yandex.ru";

  constructor(
    private readonly credentials: YandexCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    if (this.credentials.apiKey) return { "Api-Key": this.credentials.apiKey, "Content-Type": "application/json" };
    if (this.credentials.oauthToken) return { Authorization: `OAuth ${this.credentials.oauthToken}`, "Content-Type": "application/json" };
    throw new MarketplaceApiError(401);
  }

  private async request(url: string, init?: RequestInit) {
    const headers = new Headers(this.headers());
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const response = await this.fetcher(url, { ...init, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === "ERROR") {
      throw new MarketplaceApiError(response.status);
    }
    return payload;
  }

  async testConnection() {
    if (!this.credentials.campaignId) throw new MarketplaceApiError(404);
    const payload = await this.request(`${this.baseUrl}/v2/campaigns/${this.credentials.campaignId}`);
    const actualBusinessId = String(payload.campaign?.business?.id || "");
    if (!actualBusinessId || actualBusinessId !== this.credentials.businessId) {
      throw Object.assign(new Error("Campaign ID не принадлежит указанному Business ID"), {
        code: "business_mismatch",
      });
    }
    return { ok: true as const, name: payload.campaign?.domain || payload.campaign?.clientId || `Campaign ${this.credentials.campaignId}` };
  }

  async syncOrders(period: SyncPeriod) {
    const orders = this.credentials.businessId
      ? await this.businessOrders(period)
      : await this.statsOrders(period, false);
    return orders.map((order) => this.normalizeOrder(order, period));
  }

  async syncStatuses(period: SyncPeriod) {
    const orders = await this.statsOrders(period, true);
    return orders.map((order) => this.normalizeOrder(order, period));
  }

  async syncFinance(period: SyncPeriod) {
    const orders = await this.statsOrders(period, true);
    const operations: NormalizedFinancialOperation[] = [];
    orders.forEach((order) => {
      const orderId = String(order.id || order.orderId || order.partnerOrderId || "");
      (order.commissions || []).forEach((commission: any, index: number) => {
        const type = normalizeYandexCommissionType(commission.type);
        const amount = cents(commission.actual ?? commission.predicted ?? commission.amount);
        if (!amount) return;
        operations.push({
          marketplace_order_id: orderId,
          operation_id: `${orderId}:commission:${commission.type || index}`,
          operation_date: order.statusUpdateDate || order.creationDate || new Date().toISOString(),
          type,
          amount,
          description: `Яндекс Маркет: ${commission.type || "комиссия"}`,
          raw_payload: commission,
        });
      });
      (order.subsidies || []).forEach((subsidy: any, index: number) => {
        const amount = cents(subsidy.amount ?? subsidy.actual);
        if (!amount) return;
        operations.push({
          marketplace_order_id: orderId,
          operation_id: `${orderId}:subsidy:${subsidy.type || index}`,
          operation_date: order.statusUpdateDate || order.creationDate || new Date().toISOString(),
          // stats/orders already includes subsidies in the item revenue.
          // Store them for reconciliation without adding revenue a second time.
          type: "sale",
          amount,
          description: `Яндекс Маркет: субсидия в составе выручки ${subsidy.type || ""}`.trim(),
          raw_payload: subsidy,
        });
      });
      (order.payments || []).forEach((payment: any, index: number) => {
        const amount = cents(payment.total);
        if (!amount) return;
        operations.push({
          marketplace_order_id: orderId,
          operation_id: `${orderId}:payment:${payment.id || index}`,
          operation_date: payment.date || order.statusUpdateDate || order.creationDate || new Date().toISOString(),
          type: payment.type === "REFUND" ? "return" : "sale",
          amount,
          description: payment.type === "REFUND"
            ? "Яндекс Маркет: возврат платежа покупателю"
            : "Яндекс Маркет: расчёт по заказу",
          raw_payload: payment,
        });
      });
    });
    return operations;
  }

  private async businessOrders(period: SyncPeriod) {
    const unique = new Map<string, YandexOrder>();
    for (const window of this.windows(period, 30)) {
      let pageToken = "";
      do {
        const url = new URL(`${this.baseUrl}/v1/businesses/${this.credentials.businessId}/orders`);
        url.searchParams.set("limit", "50");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const payload = await this.request(url.toString(), {
          method: "POST",
          body: JSON.stringify({
            params: {
              dateFrom: dateOnly(window.from),
              dateTo: dateOnly(window.to),
            },
          }),
        });
        for (const order of payload.result?.orders || payload.orders || []) {
          const id = String(order.id || order.orderId || order.partnerOrderId || "");
          if (id) unique.set(id, order);
        }
        pageToken = payload.result?.paging?.nextPageToken || payload.paging?.nextPageToken || "";
      } while (pageToken);
    }
    return [...unique.values()];
  }

  private async statsOrders(period: SyncPeriod, useUpdates: boolean) {
    if (!this.credentials.campaignId) throw new MarketplaceApiError(404);
    const unique = new Map<string, YandexOrder>();
    for (const window of this.windows(period, 30)) {
      let pageToken = "";
      do {
        const url = new URL(`${this.baseUrl}/v2/campaigns/${this.credentials.campaignId}/stats/orders`);
        url.searchParams.set("limit", "200");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const body = useUpdates
          ? { updateFrom: dateOnly(window.from), updateTo: dateOnly(window.to) }
          : { dateFrom: dateOnly(window.from), dateTo: dateOnly(window.to) };
        const payload = await this.request(url.toString(), { method: "POST", body: JSON.stringify(body) });
        for (const order of payload.result?.orders || []) {
          const id = String(order.id || order.orderId || order.partnerOrderId || "");
          if (id) unique.set(id, order);
        }
        pageToken = payload.result?.paging?.nextPageToken || "";
      } while (pageToken);
    }
    return [...unique.values()];
  }

  private normalizeOrder(order: YandexOrder, period: SyncPeriod): IncomingOrder {
    const status = String(order.status || order.marketplaceStatus || "");
    const substatus = String(order.substatus || order.subStatus || order.marketplaceSubstatus || "");
    const items = (order.items || order.initialItems || []).filter(Boolean).map((item: any) => ({
      marketplace_sku: String(item.shopSku || item.offerId || item.offer?.shopSku || ""),
      name: item.offerName || item.offer?.name || "",
      quantity: Number(item.count || item.quantity || 1),
      unit_price: yandexItemUnitPrice(item),
    }));
    const payments = Array.isArray(order.payments) ? order.payments : [];
    const paymentRows = payments.filter((payment: any) => payment.type === "PAYMENT");
    const refundRows = payments.filter((payment: any) => payment.type === "REFUND");
    const confirmedPayments = paymentRows.filter((payment: any) => payment.paymentOrder?.id);
    const confirmedRefunds = refundRows.filter((payment: any) => payment.paymentOrder?.id);
    const reportedPaymentAmount = paymentRows.reduce((sum: number, payment: any) => sum + cents(payment.total), 0);
    const reportedRefundAmount = refundRows.reduce((sum: number, payment: any) => sum + cents(payment.total), 0);
    const confirmedNet = confirmedPayments.reduce((sum: number, payment: any) => sum + cents(payment.total), 0)
      - confirmedRefunds.reduce((sum: number, payment: any) => sum + cents(payment.total), 0);
    const paymentStatus = confirmedPayments.length
      ? confirmedNet <= 0 ? "refunded" : "paid"
      : payments.length ? "expected" : "not_available";
    return {
      marketplace: "yandex",
      marketplace_order_id: String(order.id || order.orderId || order.partnerOrderId),
      marketplace_status: status,
      marketplace_substatus: substatus,
      order_date: order.creationDate || order.createdAt || period.from,
      shipment_date: order.delivery?.shipment?.shipmentDate
        || order.delivery?.shipments?.[0]?.shipmentDate
        || order.delivery?.dates?.fromDate
        || "",
      delivery_date: order.delivery?.dates?.realDeliveryDate
        || order.delivery?.dates?.toDate
        || order.deliveryDate
        || "",
      reported_payment_amount: reportedPaymentAmount,
      reported_refund_amount: reportedRefundAmount,
      confirmed_payout_amount: Math.max(0, confirmedNet),
      payment_status: paymentStatus,
      payment_date: latestDate(payments.map((payment: any) => String(payment.date || ""))),
      payout_date: latestDate(payments.map((payment: any) => String(payment.paymentOrder?.date || ""))),
      payment_order_id: confirmedPayments.map((payment: any) => payment.paymentOrder?.id).filter(Boolean).join(", "),
      historical: COMPLETED.has(status),
      items,
      raw_payload: order,
    };
  }

  private windows(period: SyncPeriod, maxDays: number) {
    const from = new Date(period.from);
    const to = new Date(period.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new Error("Некорректный период синхронизации");
    }
    const windows: SyncPeriod[] = [];
    let cursor = new Date(from);
    while (cursor <= to) {
      const end = new Date(Math.min(
        to.getTime(),
        cursor.getTime() + (maxDays - 1) * 86_400_000,
      ));
      windows.push({ from: cursor.toISOString(), to: end.toISOString() });
      cursor = new Date(end.getTime() + 86_400_000);
    }
    return windows;
  }

}
