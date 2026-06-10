import { afterEach, describe, expect, it, vi } from "vitest";
import { OzonAdapter } from "@/lib/integrations/ozon-adapter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OzonAdapter", () => {
  it("normalizes FBS postings with multiple products", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      result: {
        postings: [{
          posting_number: "OZ-1",
          status: "awaiting_packaging",
          in_process_at: "2026-06-01T10:00:00Z",
          products: [
            { offer_id: "OZ-A", name: "Товар A", quantity: 2, price: "500.50" },
            { offer_id: "OZ-B", name: "Товар B", quantity: 1, price: "1000" },
          ],
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const orders = await new OzonAdapter({ clientId: "123", apiKey: "redacted" }).syncOrders({
      from: "2026-06-01T00:00:00Z",
      to: "2026-06-06T00:00:00Z",
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].items).toEqual([
      { marketplace_sku: "OZ-A", name: "Товар A", quantity: 2, unit_price: 50050 },
      { marketplace_sku: "OZ-B", name: "Товар B", quantity: 1, unit_price: 100000 },
    ]);
  });

  it("normalizes commission and logistics transactions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      result: {
        operations: [{
          posting: { posting_number: "OZ-1" },
          operation_date: "2026-06-02T00:00:00Z",
          sale_commission: -150,
          services: [{ name: "MarketplaceServiceItemDirectFlowLogistic", price: -90 }],
        }],
        page_count: 1,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const operations = await new OzonAdapter({ clientId: "123", apiKey: "redacted" }).syncFinance({
      from: "2026-06-01T00:00:00Z",
      to: "2026-06-06T00:00:00Z",
    });
    expect(operations.map((item) => item.type)).toEqual(["commission", "logistics"]);
    expect(operations.map((item) => item.amount)).toEqual([15000, 9000]);
  });
});
