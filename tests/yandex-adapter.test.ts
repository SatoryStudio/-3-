import { afterEach, describe, expect, it, vi } from "vitest";
import { YandexMarketAdapter } from "@/lib/integrations/yandex-market-adapter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("YandexMarketAdapter", () => {
  it("checks that Campaign ID belongs to the configured Business ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "OK",
      campaign: {
        domain: "example.ru",
        business: { id: 77 },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const adapter = new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "77", oauthToken: "",
    });

    await expect(adapter.testConnection()).resolves.toEqual({ ok: true, name: "example.ru" });
  });

  it("rejects a Campaign ID from another business", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "OK",
      campaign: { business: { id: 78 } },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const adapter = new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "77", oauthToken: "",
    });

    await expect(adapter.testConnection()).rejects.toMatchObject({ code: "business_mismatch" });
  });

  it("normalizes paginated order statistics and financial operations", async () => {
    let request = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      request++;
      const page = request === 1
        ? {
            status: "OK",
            result: {
              orders: [{
                id: 101, creationDate: "2026-06-01", status: "PROCESSING",
                items: [{ shopSku: "SKU-1", count: 2, price: 500 }],
              }],
              paging: { nextPageToken: "next" },
            },
          }
        : {
            status: "OK",
            result: {
              orders: [{
                id: 102, creationDate: "2026-06-02", status: "DELIVERED",
                items: [{ shopSku: "SKU-2", count: 1, price: 1000 }],
              }],
              paging: {},
            },
          };
      return new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const adapter = new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "", oauthToken: "",
    });
    const orders = await adapter.syncOrders({ from: "2026-06-01T00:00:00.000Z", to: "2026-06-06T00:00:00.000Z" });
    expect(orders).toHaveLength(2);
    expect(orders[0].items[0]).toMatchObject({ marketplace_sku: "SKU-1", quantity: 2, unit_price: 50000 });
    expect(orders[1].historical).toBe(true);
  });

  it("uses the documented business orders body, 30-day windows and deduplication", async () => {
    const bodies: any[] = [];
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      bodies.push(JSON.parse(String(init?.body || "{}")));
      const index = bodies.length;
      return Response.json({
        status: "OK",
        result: {
          orders: [{
            id: index === 1 ? 101 : index === 2 ? 101 : 102,
            creationDate: index === 3 ? "2026-03-10" : "2026-01-10",
            status: "PROCESSING",
            items: [{
              shopSku: index === 3 ? "000-002" : "001",
              count: 1,
              prices: { payment: { value: index === 3 ? 900 : 500 } },
            }],
          }],
          paging: {},
        },
      });
    });
    const adapter = new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "77", oauthToken: "",
    }, fetcher as typeof fetch);

    const orders = await adapter.syncOrders({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-03-15T00:00:00.000Z",
    });

    expect(urls).toHaveLength(3);
    expect(bodies[0]).toEqual({ params: { dateFrom: "2026-01-01", dateTo: "2026-01-30" } });
    expect(bodies[1]).toEqual({ params: { dateFrom: "2026-01-31", dateTo: "2026-03-01" } });
    expect(bodies[2]).toEqual({ params: { dateFrom: "2026-03-02", dateTo: "2026-03-15" } });
    expect(orders).toHaveLength(2);
    expect(orders.map((order) => order.items[0].marketplace_sku)).toEqual(["001", "000-002"]);
    expect(orders[1].items[0].unit_price).toBe(90000);
  });

  it("uses update dates from stats/orders for status synchronization", async () => {
    const requests: any[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || "{}")));
      return Response.json({
        status: "OK",
        result: {
          orders: [{
            id: 101, creationDate: "2026-01-01", status: "DELIVERY",
            items: [{ shopSku: "SKU-1", count: 1, price: 500 }],
          }],
          paging: {},
        },
      });
    });
    const adapter = new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "77", oauthToken: "",
    }, fetcher as typeof fetch);

    const orders = await adapter.syncStatuses({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-07T00:00:00.000Z",
    });

    expect(requests[0]).toEqual({ updateFrom: "2026-06-01", updateTo: "2026-06-07" });
    expect(orders[0].marketplace_status).toBe("DELIVERY");
  });

  it("maps commissions to normalized finance types", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "OK",
      result: {
        orders: [{
          id: 101,
          creationDate: "2026-06-01",
          commissions: [{ type: "FEE", actual: 125.5 }, { type: "AUCTION_PROMOTION", actual: 20 }],
          subsidies: [{ type: "YANDEX", amount: 15 }],
        }],
        paging: {},
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const operations = await new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "", oauthToken: "",
    }).syncFinance({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-06T00:00:00.000Z",
    });
    expect(operations.map((operation) => operation.type)).toEqual(["commission", "boost", "sale"]);
    expect(operations[0].amount).toBe(12550);
  });

  it("builds revenue from all Yandex price components without multiplying quantity twice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      status: "OK",
      result: {
        orders: [{
          id: 103,
          creationDate: "2026-06-01",
          status: "DELIVERED",
          items: [{
            shopSku: "000-020",
            count: 2,
            prices: [
              { type: "MARKETPLACE", costPerItem: 777, total: 1554 },
              { type: "BUYER", costPerItem: 223, total: 446 },
            ],
          }],
          payments: [{
            id: "payment-1",
            date: "2026-06-03",
            type: "PAYMENT",
            source: "BUYER",
            total: 446,
          }],
        }],
        paging: {},
      },
    })));
    const adapter = new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "", oauthToken: "",
    });

    const orders = await adapter.syncOrders({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-06T00:00:00.000Z",
    });

    expect(orders[0].items[0]).toMatchObject({
      quantity: 2,
      unit_price: 100000,
    });
    expect(orders[0]).toMatchObject({
      reported_payment_amount: 44600,
      confirmed_payout_amount: 0,
      payment_status: "expected",
      payment_date: "2026-06-03",
      payout_date: "",
    });
  });

  it("divides business order payment and subsidy totals by quantity", async () => {
    const fetcher = vi.fn(async () => Response.json({
      status: "OK",
      result: {
        orders: [{
          orderId: 104,
          creationDate: "2026-06-01",
          status: "DELIVERED",
          items: [{
            offerId: "000-020",
            count: 2,
            prices: {
              payment: { value: 446 },
              subsidy: { value: 1554 },
            },
          }],
        }],
        paging: {},
      },
    }));
    const adapter = new YandexMarketAdapter({
      apiKey: "redacted-test-key", campaignId: "42", businessId: "77", oauthToken: "",
    }, fetcher as typeof fetch);

    const orders = await adapter.syncOrders({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-06T00:00:00.000Z",
    });

    expect(orders[0].items[0]).toMatchObject({
      quantity: 2,
      unit_price: 100000,
    });
  });
});
