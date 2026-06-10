import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/domain/types";
import { GoogleSheetsService } from "@/lib/services/google-sheets-service";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { emptyDatabase, product, spool, unit } from "@/tests/helpers";

class MemoryStorage {
  constructor(public data: Database = emptyDatabase()) {}
  async initialize() {}
  async read() { return structuredClone(this.data); }
  async transaction(operation) {
    const working = structuredClone(this.data);
    const result = await operation({ data: working, touch: () => {} });
    this.data = working;
    return result;
  }
}

describe("SKU normalization integration tests", () => {
  it("treats differently formatted SKUs as equal during ingestion", () => {
    const data = emptyDatabase();
    data.products.push(product({ marketplace: "yandex", marketplace_sku: "AbC-123" }));
    data.filament_spools.push(spool());

    // create existing order with differently formatted stored SKU
    const existingOrder = {
      id: crypto.randomUUID(), marketplace: "yandex", marketplace_order_id: "ORD-1",
      marketplace_status: "", marketplace_substatus: "", internal_status: "delivered",
      order_date: "2026-01-01T00:00:00.000Z", shipment_date: "", delivery_date: "",
      historical: false, gross_revenue: 0, expected_payout: 0, actual_payout: 0,
      reported_payment_amount: 0, reported_refund_amount: 0, payment_status: "not_available",
      payment_date: "", payout_date: "", payment_order_id: "", marketplace_cost: 0,
      production_cost: 0, profit: 0, margin_percent: 0, calculation_state: "estimated",
      profit_status: "complete", problem_code: "", problem_message: "", raw_payload: "",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    data.orders.push(existingOrder);
    data.order_items.push({
      id: crypto.randomUUID(), order_id: existingOrder.id, product_id: data.products[0].id,
      marketplace_sku: " abc-123 ", name: "Товар", quantity: 1, unit_price: 10000, revenue: 10000,
      planned_filament_grams: 100, reserved_filament_grams: 0, actual_filament_grams: 0, failed_filament_grams: 0,
      spool_id: "", filament_cost: 0, packaging_cost: 0, electricity_cost: 0, extra_cost: 0,
      production_cost: 0, allocated_marketplace_cost: 0, profit: 0, margin_percent: 0,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });

    const result = orderIngestionService.ingest(unit(data), {
      marketplace: "yandex", marketplace_order_id: "ORD-1", marketplace_status: "PROCESSING",
      order_date: "2026-06-07T00:00:00.000Z",
      items: [{ marketplace_sku: "ABC-123", quantity: 1, unit_price: 10000 }],
    });

    // when SKUs normalize equal, ingestion should return updated (not production_locked)
    expect(result.outcome).toBe("updated");
  });

  it("does not deactivate products when sheet contains differently formatted SKU", async () => {
    const storage = new MemoryStorage();
    storage.data.products.push(product({ marketplace: "yandex", marketplace_sku: "old_sku", is_active: true }));

    const fetcher = async (input) => {
      const url = String(input);
      // emulate google values API returning differently cased SKU
      if (url.includes("/values/")) {
        return Response.json({ values: [["Артикул", "Название"], ["OLD_SKU", "Товар"]] });
      }
      if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "x" });
      if (url.includes("?fields=sheets.properties")) return Response.json({ sheets: [{ properties: { sheetId: 0, title: "Товары" } }] });
      throw new Error(`Unexpected URL: ${url}`);
    };

    const service = new GoogleSheetsService(storage as never, {
      getGoogleSettings: async () => ({ client_id: "c", client_secret: "s", refresh_token: "r", products_sheet_url: "https://docs.google.com/spreadsheets/d/products/edit#gid=0" }),
      getProviderSettingsStatus: async () => ({}),
    } as never, fetcher as typeof fetch);

    const report = await service.sync("products");
    expect(report.status).toBe("success");
    // product should remain active because normalized SKU matches
    // the existing product should remain active (it may be updated in-place)
    expect(storage.data.products[0].is_active).toBe(true);
  });
});
