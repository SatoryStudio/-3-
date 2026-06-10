import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/domain/types";
import {
  GoogleSheetsService,
  getGoogleOAuthRedirectUri,
  GOOGLE_OAUTH_SCOPES,
  parseGoogleSheetUrl,
} from "@/lib/services/google-sheets-service";
import type { StorageAdapter, UnitOfWork } from "@/lib/storage/storage-adapter";
import { inventoryService } from "@/lib/services/inventory-service";
import { marketplaceLifecycleStatus, refreshOrderLifecycle } from "@/lib/services/order-status-service";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { emptyDatabase, product, spool, unit } from "@/tests/helpers";

class MemoryStorage implements StorageAdapter {
  constructor(public data: Database = emptyDatabase()) {}
  async initialize() {}
  async read() { return structuredClone(this.data); }
  async transaction<T>(operation: (unit: UnitOfWork) => Promise<T> | T) {
    const working = structuredClone(this.data);
    const result = await operation({ data: working, touch: () => {} });
    this.data = working;
    return result;
  }
}

function googleSettings(values: Record<string, string>) {
  return {
    getGoogleSettings: async () => values,
    getProviderSettingsStatus: async () => ({
      provider: "google_sheets",
      configured: Boolean(values.client_id && values.client_secret),
      fields: {
        client_id: {
          configured: Boolean(values.client_id),
          mask: "",
          displayValue: "",
          readable: true,
        },
      },
      lastSavedAt: "",
    }),
  };
}

describe("Google Sheets and order lifecycle", () => {
  it("builds the OAuth callback exclusively from normalized APP_URL", () => {
    expect(getGoogleOAuthRedirectUri("http://localhost:3000"))
      .toBe("http://localhost:3000/api/google/oauth/callback");
    expect(getGoogleOAuthRedirectUri("https://aidaassistant.ru/"))
      .toBe("https://aidaassistant.ru/api/google/oauth/callback");
    expect(getGoogleOAuthRedirectUri("", "development"))
      .toBe("http://localhost:3000/api/google/oauth/callback");
    expect(() => getGoogleOAuthRedirectUri("http://aidaassistant.ru")).toThrow("HTTPS");
    expect(() => getGoogleOAuthRedirectUri("", "production")).toThrow("APP_URL");
    expect(GOOGLE_OAUTH_SCOPES).toContain("https://www.googleapis.com/auth/drive.readonly");
  });

  it("parses spreadsheet id and gid and rejects non-Google URLs", () => {
    expect(parseGoogleSheetUrl("https://docs.google.com/spreadsheets/d/abc-123/edit#gid=456"))
      .toMatchObject({ spreadsheetId: "abc-123", gid: 456 });
    expect(() => parseGoogleSheetUrl("https://example.com/file.xlsx")).toThrow("Google Sheets");
  });

  it("reports OAuth and both sheet targets independently", async () => {
    const storage = new MemoryStorage();
    storage.data.products.push(product({ is_active: true }), product({ is_active: false }));
    storage.data.filament_spools.push(spool({ status: "active" }), spool({ status: "archived" }));
    storage.data.sync_logs.push(
      {
        id: "products-success", run_id: "", entry_type: "step", source: "google_sheets",
        operation: "sync_google_products", status: "success",
        started_at: "2026-06-07T09:00:00.000Z", finished_at: "2026-06-07T09:01:00.000Z",
        summary: JSON.stringify({ status: "success", created: 3, updated: 2, errors: 0 }),
        error_code: "", safe_message: "", order_id: "", sku: "", period_from: "", period_to: "",
        created_at: "2026-06-07T09:00:00.000Z",
      },
      {
        id: "products-error", run_id: "", entry_type: "error", source: "google_sheets",
        operation: "sync_google_products", status: "error",
        started_at: "2026-06-07T10:00:00.000Z", finished_at: "2026-06-07T10:01:00.000Z",
        summary: JSON.stringify({ status: "error", created: 0, updated: 0, errors: 1 }),
        error_code: "UNKNOWN_ERROR", safe_message: "Google-таблица недоступна",
        order_id: "", sku: "", period_from: "", period_to: "",
        created_at: "2026-06-07T10:00:00.000Z",
      },
    );
    const service = new GoogleSheetsService(storage, googleSettings({
      client_id: "client-id",
      client_secret: "secret",
      products_sheet_url: "https://docs.google.com/spreadsheets/d/products/edit",
      filament_sheet_url: "https://docs.google.com/spreadsheets/d/filament/edit",
    }) as never);

    const status = await service.status();

    expect(status.oauth).toMatchObject({
      credentialsConfigured: true,
      connected: false,
      status: "not_connected",
    });
    expect(status.products).toMatchObject({
      configured: true,
      accessible: false,
      canSync: true,
      importedCount: 1,
      created: 0,
      updated: 0,
      errors: 1,
      lastSuccessfulSyncAt: "2026-06-07T09:01:00.000Z",
      lastError: "Google-таблица недоступна",
    });
    expect(status.filament).toMatchObject({
      configured: true,
      accessible: null,
      canSync: true,
      importedCount: 1,
      lastSuccessfulSyncAt: "",
    });
  });

  it("distinguishes a missing sheet URL from a closed public sheet", async () => {
    const storage = new MemoryStorage();
    const withoutOAuth = new GoogleSheetsService(storage, googleSettings({
      products_sheet_url: "https://docs.google.com/spreadsheets/d/products/edit",
    }) as never, async () => new Response("<!doctype html><title>Войти</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    const withoutUrl = new GoogleSheetsService(storage, googleSettings({}) as never);

    await expect(withoutOAuth.sync("products")).resolves.toMatchObject({
      status: "error",
      source: "none",
      errors: 1,
      rowErrors: [{ reason: expect.stringContaining("Все, у кого есть ссылка") }],
    });
    await expect(withoutUrl.sync("products")).resolves.toMatchObject({
      status: "skipped",
      reason: "not_configured",
    });
  });

  it("prefers Google API over public CSV and imports formatted leading-zero SKU", async () => {
    const storage = new MemoryStorage();
    const calls: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "access" });
      }
      if (url.includes("?fields=sheets.properties")) {
        return Response.json({ sheets: [{ properties: { sheetId: 0, title: "Товары" } }] });
      }
      if (url.includes("/values/")) {
        return Response.json({ values: [
          ["Артикул", "Название", "Вес (грам)", "Тип пластика", "Цвет", "Время печати"],
          ["001", "Клипса", "12", "PLA", "чёрный", "25"],
        ] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const service = new GoogleSheetsService(storage, googleSettings({
      client_id: "client", client_secret: "secret", refresh_token: "refresh",
      products_sheet_url: "https://docs.google.com/spreadsheets/d/products/edit#gid=0",
    }) as never, fetcher as typeof fetch);

    const report = await service.sync("products");

    expect(report).toMatchObject({
      status: "success", source: "google_api", rowsRead: 1, created: 1, errors: 0,
    });
    expect(storage.data.products[0]).toMatchObject({
      marketplace: "yandex", marketplace_sku: "001", name: "Клипса",
      filament_material: "PLA", filament_color: "чёрный", weight_grams: 12,
    });
    expect(calls.some((url) => url.includes("/export?"))).toBe(false);
  });

  it("uses gviz after export fails and does not deactivate absent products", async () => {
    const storage = new MemoryStorage();
    storage.data.products.push(product({
      marketplace: "yandex", marketplace_sku: "OLD", is_active: true,
    }));
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/export?")) return new Response("forbidden", { status: 403 });
      if (url.includes("/gviz/")) {
        return new Response(
          "Артикул,Название,\"Вес (грам)\",Тип пластика,Цвет\n000-001,Органайзер,100,PETG,белый\n",
          { status: 200, headers: { "content-type": "text/csv" } },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const service = new GoogleSheetsService(storage, googleSettings({
      products_sheet_url: "https://docs.google.com/spreadsheets/d/products/edit",
    }) as never, fetcher as typeof fetch);

    const report = await service.sync("products");

    expect(report).toMatchObject({
      status: "success", source: "public_csv", rowsRead: 1, created: 1,
    });
    expect(storage.data.products.find((item) => item.marketplace_sku === "OLD")?.is_active).toBe(true);
    expect(storage.data.products.find((item) => item.marketplace_sku === "000-001")).toBeTruthy();
  });

  it("assigns stable internal ids to public rows without spool_id and audits weight", async () => {
    const storage = new MemoryStorage();
    storage.data.filament_spools.push(spool({ id: "keep-me", status: "active" }));
    const csv = [
      "spool_id,Дата,Материал,Цвет,\"Вес, г\",Цена,Поставщик,Место",
      ",07.06.2026,PLA,чёрный,1000,1200,Пластик Про,Стеллаж 1",
      "spool-2,07.06.2026,PETG,белый,750,900,Поставщик,Шкаф",
    ].join("\n");
    const fetcher = async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8" },
    });
    const service = new GoogleSheetsService(storage, googleSettings({
      filament_sheet_url: "https://docs.google.com/spreadsheets/d/filament/edit",
    }) as never, fetcher as typeof fetch);

    const report = await service.sync("filament");
    const generatedId = storage.data.filament_spools.find((item) => item.id !== "keep-me" && item.id !== "spool-2")?.id;
    storage.data.filament_spools.find((item) => item.id === "spool-2")!.remaining_weight_grams = 600;
    const second = await service.sync("filament");

    expect(report).toMatchObject({
      status: "success", source: "public_csv",
      rowsRead: 2, imported: 2, created: 2, skipped: 0, errors: 0,
      sourceWeightGrams: 1750, erpInitialWeightGrams: 1750,
      erpRemainingWeightGrams: 1750, weightDifferenceGrams: 0,
    });
    expect(generatedId).toBeTruthy();
    expect(second).toMatchObject({ created: 0, updated: 2, errors: 0 });
    expect(storage.data.filament_spools.filter((item) => item.id === generatedId)).toHaveLength(1);
    expect(storage.data.filament_spools.find((item) => item.id === generatedId)).toMatchObject({
      google_spreadsheet_id: "filament",
      google_sheet_gid: 0,
      google_row_number: 2,
    });
    expect(storage.data.filament_spools.find((item) => item.id === "spool-2")).toMatchObject({
      supplier: "Поставщик", brand: "Поставщик", location: "Шкаф",
      remaining_weight_grams: 600, price_per_spool: 90000, price_per_kg: 120000,
    });
    expect(storage.data.filament_spools.find((item) => item.id === "keep-me")?.status).toBe("active");
  });

  it("parses all supported ruble price formats without losing magnitude", async () => {
    const storage = new MemoryStorage();
    const csv = [
      "spool_id,Материал,Цвет,\"Вес, г\",Цена",
      "spool-rub-1,PLA Basic,черный,1000,р.4 100",
      "spool-rub-2,PLA Basic,черный,1000,4 100",
      "spool-rub-3,PLA Basic,черный,1000,4100",
    ].join("\n");
    const service = new GoogleSheetsService(storage, googleSettings({
      filament_sheet_url: "https://docs.google.com/spreadsheets/d/filament/edit",
    }) as never, async () => new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv" },
    }));

    const report = await service.sync("filament");

    expect(report).toMatchObject({ status: "success", created: 3, imported: 3, errors: 0 });
    expect(storage.data.filament_spools.every((item) =>
      item.price_per_spool === 410000 && item.price_per_kg === 410000)).toBe(true);
  });

  it("keeps leading zero SKU during ingestion", () => {
    const data = emptyDatabase();
    data.products.push(product({ marketplace: "yandex", marketplace_sku: "001" }));
    data.filament_spools.push(spool());
    orderIngestionService.ingest(unit(data), {
      marketplace: "yandex", marketplace_order_id: "Y-001", marketplace_status: "PROCESSING",
      order_date: "2026-06-07T00:00:00.000Z",
      items: [{ marketplace_sku: "001", quantity: 1, unit_price: 10000 }],
    });
    expect(data.order_items[0].marketplace_sku).toBe("001");
    expect(data.orders[0].internal_status).toBe("waiting_production");
  });

  it("records Google stock corrections through InventoryService and protects reserve", () => {
    const data = emptyDatabase();
    const filament = spool({ reserved_weight_grams: 200 });
    data.filament_spools.push(filament);
    inventoryService.adjustRemaining(unit(data), filament.id, 800, "Google Sheets");
    expect(filament.remaining_weight_grams).toBe(800);
    expect(data.filament_movements[0]).toMatchObject({ type: "manual_adjustment", grams: -200 });
    expect(() => inventoryService.adjustRemaining(unit(data), filament.id, 100, "Google Sheets")).toThrow("резерва");
  });

  it("normalizes marketplace logistics without rebuilding production", () => {
    expect(marketplaceLifecycleStatus({ marketplace_status: "NEW", marketplace_substatus: "" })).toBeUndefined();
    expect(marketplaceLifecycleStatus({ marketplace_status: "PROCESSING", marketplace_substatus: "" })).toBeUndefined();
    expect(marketplaceLifecycleStatus({ marketplace_status: "READY_TO_SHIP", marketplace_substatus: "" })).toBe("ready_to_ship");
    expect(marketplaceLifecycleStatus({ marketplace_status: "SHIPPED", marketplace_substatus: "" })).toBe("in_transit");
    expect(marketplaceLifecycleStatus({ marketplace_status: "DELIVERY", marketplace_substatus: "" })).toBe("in_transit");
    expect(marketplaceLifecycleStatus({ marketplace_status: "DELIVERED", marketplace_substatus: "" })).toBe("delivered");
    expect(marketplaceLifecycleStatus({ marketplace_status: "CANCELLED", marketplace_substatus: "" })).toBe("cancelled");
    expect(marketplaceLifecycleStatus({ marketplace_status: "CANCELLED_IN_PROCESSING", marketplace_substatus: "" })).toBe("cancelled");
    expect(marketplaceLifecycleStatus({ marketplace_status: "CANCELLED_IN_DELIVERY", marketplace_substatus: "" })).toBe("cancelled");
    const data = emptyDatabase();
    data.products.push(product({ marketplace: "yandex", marketplace_sku: "SKU-1" }));
    data.filament_spools.push(spool());
    orderIngestionService.ingest(unit(data), {
      marketplace: "yandex", marketplace_order_id: "LOCKED", marketplace_status: "PROCESSING",
      order_date: "2026-06-07T00:00:00.000Z",
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 10000 }],
    });
    const order = data.orders[0];
    const jobId = data.print_jobs[0].id;
    data.print_jobs[0].status = "printing";
    data.print_jobs[0].started_at = "2026-06-07T01:00:00.000Z";
    order.marketplace_status = "DELIVERY";
    refreshOrderLifecycle(unit(data), order);
    expect(order.internal_status).toBe("in_transit");
    expect(data.print_jobs[0].id).toBe(jobId);
  });

  it("releases an unstarted reserve after Yandex accepts the order for delivery", () => {
    const data = emptyDatabase();
    data.products.push(product({ marketplace: "yandex", marketplace_sku: "SKU-1" }));
    data.filament_spools.push(spool());
    const work = unit(data);
    orderIngestionService.ingest(work, {
      marketplace: "yandex", marketplace_order_id: "SHIPPED", marketplace_status: "PROCESSING",
      order_date: "2026-06-07T00:00:00.000Z",
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 10000 }],
    });

    orderIngestionService.updateMarketplaceState(work, {
      marketplace: "yandex", marketplace_order_id: "SHIPPED", marketplace_status: "DELIVERY",
      order_date: "2026-06-07T00:00:00.000Z",
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 10000 }],
    });

    expect(data.orders[0].internal_status).toBe("in_transit");
    expect(data.filament_spools[0].reserved_weight_grams).toBe(0);
    expect(data.order_items[0].reserved_filament_grams).toBe(0);
    expect(data.print_jobs[0].status).toBe("cancelled");
    expect(data.filament_movements.at(-1)?.type).toBe("unreserve");
  });
});
