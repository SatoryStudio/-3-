import { describe, expect, it } from "vitest";
import { inventoryService } from "@/lib/services/inventory-service";
import { orderIngestionService } from "@/lib/services/order-ingestion-service";
import { orderProblemDetails } from "@/lib/services/order-diagnostics-service";
import { emptyDatabase, product, spool, unit } from "@/tests/helpers";

describe("OrderIngestionService and InventoryService", () => {
  it("matches PETG and PETG Basic as the same material", () => {
    const data = emptyDatabase();
    data.products.push(product({
      marketplace: "manual",
      filament_material: "PETG Basic",
      filament_color: "Белый",
    }));
    data.filament_spools.push(spool({
      material: "PETG",
      color: "Белый",
    }));
    const result = orderIngestionService.ingest(unit(data), {
      marketplace: "manual",
      marketplace_order_id: "PETG-ALIAS",
      order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    expect(result.outcome).toBe("created");
    expect(data.order_items[0].spool_id).toBeTruthy();
    expect(data.orders[0].profit_status).toBe("complete");
  });

  it("updates marketplace status without replacing order details or precise creation date", () => {
    const data = emptyDatabase();
    data.products.push(product({ marketplace: "yandex", marketplace_sku: "SKU-1" }));
    data.filament_spools.push(spool());
    const work = unit(data);
    orderIngestionService.ingest(work, {
      marketplace: "yandex",
      marketplace_order_id: "STATUS-ONLY",
      marketplace_status: "PROCESSING",
      order_date: "2026-06-09T23:22:32.637+03:00",
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    const itemId = data.order_items[0].id;
    const spoolId = data.order_items[0].spool_id;

    orderIngestionService.updateMarketplaceState(work, {
      marketplace: "yandex",
      marketplace_order_id: "STATUS-ONLY",
      marketplace_status: "DELIVERY",
      order_date: "2026-06-09",
      shipment_date: "2026-06-10",
      items: [{ marketplace_sku: "SKU-1", quantity: 99, unit_price: 1 }],
    });

    expect(data.orders[0]).toMatchObject({
      marketplace_status: "DELIVERY",
      order_date: "2026-06-09T23:22:32.637+03:00",
      shipment_date: "2026-06-10",
    });
    expect(data.order_items[0]).toMatchObject({
      id: itemId,
      spool_id: spoolId,
      quantity: 1,
      unit_price: 100000,
    });
  });

  it("matches PLA Base to PLA Basic and Russian black case-insensitively", () => {
    const data = emptyDatabase();
    data.products.push(product({
      marketplace: "yandex",
      marketplace_sku: "000-018",
      filament_material: "PLA Base",
      filament_color: "Черный",
      weight_grams: 47,
    }));
    data.filament_spools.push(spool({
      material: "PLA BASIC",
      color: "black",
      remaining_weight_grams: 1000,
    }));
    const result = orderIngestionService.ingest(unit(data), {
      marketplace: "yandex",
      marketplace_order_id: "NORMALIZED",
      marketplace_status: "PROCESSING",
      order_date: "2026-06-07T00:00:00.000Z",
      items: [{ marketplace_sku: "000-018", quantity: 1, unit_price: 89900 }],
    });
    expect(result.outcome).toBe("created");
    expect(data.orders[0].internal_status).toBe("waiting_production");
    expect(data.order_items[0].reserved_filament_grams).toBe(47);
    expect(data.print_jobs).toHaveLength(1);
  });

  it("reserves every item and chooses the oldest sufficient spool", () => {
    const data = emptyDatabase();
    data.products.push(product(), product({ id: crypto.randomUUID(), marketplace_sku: "SKU-2", weight_grams: 200 }));
    const newer = spool({ purchase_date: "2026-02-01" });
    const older = spool({ purchase_date: "2026-01-01" });
    data.filament_spools.push(newer, older);
    const work = unit(data);
    const result = orderIngestionService.ingest(work, {
      marketplace: "manual", marketplace_order_id: "M-1", order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }, { marketplace_sku: "SKU-2", quantity: 1, unit_price: 200000 }],
    });
    expect(result.outcome).toBe("created");
    expect(data.orders[0].internal_status).toBe("waiting_production");
    expect(data.order_items).toHaveLength(2);
    expect(data.order_items.every((item) => item.spool_id === older.id)).toBe(true);
    expect(older.reserved_weight_grams).toBe(300);
    expect(data.print_jobs).toHaveLength(2);
  });

  it("rolls back every provisional reserve if one item cannot be supplied", () => {
    const data = emptyDatabase();
    data.products.push(product(), product({ id: crypto.randomUUID(), marketplace_sku: "SKU-2", weight_grams: 950 }));
    const only = spool();
    data.filament_spools.push(only);
    const result = orderIngestionService.ingest(unit(data), {
      marketplace: "manual", marketplace_order_id: "M-2", order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }, { marketplace_sku: "SKU-2", quantity: 1, unit_price: 200000 }],
    });
    expect(result.outcome).toBe("problem");
    expect(data.orders[0].internal_status).toBe("problem");
    expect(only.reserved_weight_grams).toBe(0);
    expect(data.filament_movements).toHaveLength(0);
    expect(data.print_jobs).toHaveLength(0);
  });

  it("explains why normalized spool candidates were rejected", () => {
    const data = emptyDatabase();
    data.products.push(product({
      marketplace: "yandex",
      marketplace_sku: "DIAG",
      filament_material: "PLA Base",
      filament_color: "BLACK",
      weight_grams: 500,
    }));
    data.filament_spools.push(
      spool({ id: "wrong-color", material: "PLA Basic", color: "Белый" }),
      spool({ id: "not-enough", material: "PLA BASIC", color: "чёрный", remaining_weight_grams: 400 }),
      spool({ id: "archived", material: "PLA Basic", color: "Black", status: "archived" }),
    );
    orderIngestionService.ingest(unit(data), {
      marketplace: "yandex", marketplace_order_id: "DIAGNOSTICS",
      order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "DIAG", quantity: 1, unit_price: 100000 }],
    });

    const details = orderProblemDetails(data, data.orders[0])[0];

    expect(details).toMatchObject({
      normalizedMaterial: "pla basic",
      normalizedColor: "черный",
      materialMatchCount: 3,
      colorMatchCount: 2,
    });
    expect(details.candidateSpools.find((item) => item.id === "wrong-color")?.reasons)
      .toContain("не тот цвет");
    expect(details.candidateSpools.find((item) => item.id === "not-enough")?.reasons)
      .toContain("недостаточно свободного веса");
    expect(details.candidateSpools.find((item) => item.id === "archived")?.reasons)
      .toContain("катушка архивирована");
  });

  it("writes off failed grams while preserving the order reserve", () => {
    const data = emptyDatabase();
    data.products.push(product());
    const filament = spool();
    data.filament_spools.push(filament);
    orderIngestionService.ingest(unit(data), {
      marketplace: "manual", marketplace_order_id: "M-3", order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    const job = data.print_jobs[0];
    inventoryService.failPrint(unit(data), job.id, 25);
    expect(filament.remaining_weight_grams).toBe(975);
    expect(filament.reserved_weight_grams).toBe(100);
    expect(data.order_items[0].failed_filament_grams).toBe(25);
    expect(data.orders[0].internal_status).toBe("in_production");
  });

  it("finishes a print without allowing negative stock", () => {
    const data = emptyDatabase();
    data.products.push(product());
    const filament = spool();
    data.filament_spools.push(filament);
    orderIngestionService.ingest(unit(data), {
      marketplace: "manual", marketplace_order_id: "M-4", order_date: new Date().toISOString(),
      items: [{ marketplace_sku: "SKU-1", quantity: 1, unit_price: 100000 }],
    });
    expect(() => inventoryService.completePrint(unit(data), data.print_jobs[0].id, 1200)).toThrow();
    inventoryService.completePrint(unit(data), data.print_jobs[0].id, 95);
    expect(filament.remaining_weight_grams).toBe(905);
    expect(filament.reserved_weight_grams).toBe(0);
    expect(data.orders[0].internal_status).toBe("printed");
  });
});
