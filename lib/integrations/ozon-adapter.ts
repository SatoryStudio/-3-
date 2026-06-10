import type { IncomingOrder } from "@/lib/domain/types";
import { MarketplaceApiError } from "@/lib/integrations/integration-error";
import type { MarketplaceAdapter, NormalizedFinancialOperation, SyncPeriod } from "@/lib/integrations/marketplace-adapter";
import type { OzonCredentials } from "@/lib/services/integration-settings-service";

type OzonPosting = Record<string, any>;

const ACTIVE_STATUSES = ["awaiting_packaging", "awaiting_deliver", "delivering"];
const HISTORY_STATUSES = ["delivered", "cancelled"];

function cents(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : 0;
}

export class OzonAdapter implements MarketplaceAdapter {
  private readonly baseUrl = "https://api-seller.ozon.ru";

  constructor(private readonly credentials: OzonCredentials) {}

  private headers(): Record<string, string> {
    if (!this.credentials.clientId || !this.credentials.apiKey) throw new MarketplaceApiError(401);
    return { "Client-Id": this.credentials.clientId, "Api-Key": this.credentials.apiKey, "Content-Type": "application/json" };
  }

  private async request(path: string, body: unknown) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new MarketplaceApiError(response.status);
    }
    return payload;
  }

  async testConnection() {
    const payload = await this.request("/v1/seller/info", {});
    return {
      ok: true as const,
      name: payload.company?.name || payload.name || payload.seller_name || `Ozon Seller ${this.credentials.clientId}`,
    };
  }

  async syncOrders(period: SyncPeriod) {
    const postings = await this.fetchPostings(period);
    return postings.map((posting) => this.normalizePosting(posting));
  }

  async syncStatuses(period: SyncPeriod) {
    return this.syncOrders(period);
  }

  async syncFinance(period: SyncPeriod) {
    const operations: any[] = [];
    const pageSize = 1000;
    for (let page = 1; page <= 20; page++) {
      const payload = await this.request("/v3/finance/transaction/list", {
        filter: {
          date: { from: period.from, to: period.to },
          operation_type: [],
          posting_number: "",
          transaction_type: "all",
        },
        page,
        page_size: pageSize,
      });
      const pageOperations = payload.result?.operations || payload.result?.items || payload.operations || [];
      operations.push(...pageOperations);
      const pageCount = Number(payload.result?.page_count || payload.result?.pageCount || 0);
      if ((pageCount && page >= pageCount) || pageOperations.length < pageSize) break;
    }

    const normalized: NormalizedFinancialOperation[] = [];
    operations.forEach((operation, index) => {
      const orderId = String(
        operation.posting?.posting_number || operation.posting_number
        || operation.posting?.postingNumber || operation.postingNumber || "",
      );
      if (!orderId) return;
      const date = operation.operation_date || operation.operationDate || period.to;
      const commission = cents(operation.sale_commission);
      if (commission) normalized.push(this.financeRow(orderId, operation, index, "commission", commission, "Комиссия Ozon", date));
      (operation.services || []).forEach((service: any, serviceIndex: number) => {
        const amount = cents(service.price ?? service.amount);
        if (!amount) return;
        normalized.push(this.financeRow(
          orderId, service, `${index}:${serviceIndex}`, this.serviceType(service.name || service.service_name),
          amount, `Ozon: ${service.name || service.service_name || "услуга"}`, date,
        ));
      });
      if (!commission && !(operation.services || []).length) {
        const amount = Number(operation.amount || 0);
        if (!amount) return;
        normalized.push(this.financeRow(
          orderId, operation, index, amount > 0 ? "compensation" : "other",
          cents(amount), operation.operation_type_name || operation.operation_type || "Операция Ozon", date,
        ));
      }
    });
    return normalized;
  }

  private async fetchPostings(period: SyncPeriod) {
    const postings = new Map<string, OzonPosting>();
    for (const status of [...ACTIVE_STATUSES, ...HISTORY_STATUSES]) {
      let offset = 0;
      while (true) {
        const payload = await this.request("/v3/posting/fbs/list", {
          dir: "ASC",
          filter: { since: period.from, to: period.to, status },
          limit: 100,
          offset,
          with: { analytics_data: true, financial_data: true },
        });
        const page = payload.result?.postings || [];
        page.forEach((posting: OzonPosting) => {
          const id = posting.posting_number || posting.order_number || posting.order_id;
          if (id) postings.set(String(id), posting);
        });
        if (page.length < 100) break;
        offset += page.length;
      }
    }
    return [...postings.values()];
  }

  private normalizePosting(posting: OzonPosting): IncomingOrder {
    const status = String(posting.status || "");
    return {
      marketplace: "ozon",
      marketplace_order_id: String(posting.posting_number || posting.order_number || posting.order_id),
      marketplace_status: [posting.status, posting.substatus, posting.delivery_status].filter(Boolean).join(" "),
      order_date: posting.in_process_at || posting.created_at || new Date().toISOString(),
      shipment_date: posting.shipment_date || "",
      historical: HISTORY_STATUSES.includes(status.toLowerCase()),
      items: (posting.products || []).map((product: any) => ({
        marketplace_sku: String(product.offer_id || product.sku || ""),
        name: product.name || product.offer_name || "",
        quantity: Number(product.quantity || 1),
        unit_price: cents(product.price),
      })).filter((item: any) => item.marketplace_sku),
      raw_payload: posting,
    };
  }

  private financeRow(
    orderId: string,
    raw: unknown,
    index: string | number,
    type: NormalizedFinancialOperation["type"],
    amount: number,
    description: string,
    operationDate: string,
  ): NormalizedFinancialOperation {
    return {
      marketplace_order_id: orderId,
      operation_id: `${orderId}:${type}:${index}`,
      operation_date: operationDate,
      type,
      amount,
      description,
      raw_payload: raw,
    };
  }

  private serviceType(name: string): NormalizedFinancialOperation["type"] {
    const value = String(name || "").toLowerCase();
    if (value.includes("logistic") || value.includes("deliver") || value.includes("pickup") || value.includes("dropoff")) return "logistics";
    if (value.includes("promo") || value.includes("action") || value.includes("loyalty")) return "boost";
    if (value.includes("advert") || value.includes("auction")) return "boost";
    if (value.includes("penalty") || value.includes("fine")) return "penalty";
    return "other";
  }
}
