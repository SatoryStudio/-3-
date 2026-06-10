import type { Database, Order } from "@/lib/domain/types";
import {
  filamentMatches,
  normalizeFilamentColor,
  normalizeFilamentMaterial,
} from "@/lib/services/filament-normalization";
import { normalizeMarketplaceSku } from "@/lib/services/sku-normalization";

export function orderProblemDetails(database: Database, order: Order) {
  const activeSpools = database.filament_spools.filter((spool) => spool.status === "active");
  const foundMaterials = [...new Set(activeSpools.map((spool) => spool.material).filter(Boolean))].sort();
  const foundColors = [...new Set(activeSpools.map((spool) => spool.color).filter(Boolean))].sort();

  return database.order_items.filter((item) => item.order_id === order.id).map((item) => {
    const product = database.products.find((candidate) =>
      candidate.is_active
      && candidate.marketplace === order.marketplace
      && normalizeMarketplaceSku(candidate.marketplace_sku) === normalizeMarketplaceSku(item.marketplace_sku));
    const compatible = product
      ? activeSpools.filter((spool) => filamentMatches(
          product.filament_material,
          product.filament_color,
          spool.material,
          spool.color,
        ))
      : [];
    const sameMaterial = product
      ? activeSpools.filter((spool) =>
          normalizeFilamentMaterial(spool.material)
          === normalizeFilamentMaterial(product.filament_material))
      : [];
    const spool = compatible.find((candidate) =>
      candidate.remaining_weight_grams - candidate.reserved_weight_grams
      >= (product?.weight_grams || 0) * item.quantity);
    const normalizedMaterial = normalizeFilamentMaterial(product?.filament_material || "");
    const normalizedColor = normalizeFilamentColor(product?.filament_color || "");
    const materialMatches = database.filament_spools.filter((candidate) =>
      normalizeFilamentMaterial(candidate.material) === normalizedMaterial);
    const colorMatches = database.filament_spools.filter((candidate) =>
      normalizeFilamentColor(candidate.color) === normalizedColor);
    const candidates = database.filament_spools.map((candidate) => {
      const reasons: string[] = [];
      const available = candidate.remaining_weight_grams - candidate.reserved_weight_grams;
      if (normalizeFilamentMaterial(candidate.material) !== normalizedMaterial) reasons.push("не тот материал");
      if (normalizeFilamentColor(candidate.color) !== normalizedColor) reasons.push("не тот цвет");
      if (candidate.status === "archived") reasons.push("катушка архивирована");
      if (candidate.remaining_weight_grams <= 0) reasons.push("нулевой остаток");
      if (candidate.reserved_weight_grams > candidate.remaining_weight_grams) reasons.push("резерв больше остатка");
      if (available < (product?.weight_grams || 0) * item.quantity) reasons.push("недостаточно свободного веса");
      return {
        id: candidate.id,
        material: candidate.material,
        color: candidate.color,
        status: candidate.status,
        remainingWeightGrams: candidate.remaining_weight_grams,
        reservedWeightGrams: candidate.reserved_weight_grams,
        availableWeightGrams: available,
        reasons,
      };
    }).filter((candidate) => candidate.reasons.length < 3
      || normalizeFilamentMaterial(candidate.material) === normalizedMaterial
      || normalizeFilamentColor(candidate.color) === normalizedColor);

    return {
      sku: item.marketplace_sku,
      productName: product?.name || item.name,
      productFound: Boolean(product),
      requiredMaterial: product?.filament_material || "",
      requiredColor: product?.filament_color || "",
      normalizedMaterial,
      normalizedColor,
      requiredWeightGrams: product ? product.weight_grams * item.quantity : 0,
      spoolFound: Boolean(spool),
      spoolId: spool?.id || "",
      spoolRemainingGrams: spool?.remaining_weight_grams || 0,
      spoolReservedGrams: spool?.reserved_weight_grams || 0,
      compatibleSpools: compatible.map((candidate) => ({
        id: candidate.id,
        material: candidate.material,
        color: candidate.color,
        remainingWeightGrams: candidate.remaining_weight_grams,
        reservedWeightGrams: candidate.reserved_weight_grams,
      })),
      foundMaterials,
      foundColors,
      foundColorsForMaterial: [...new Set(sameMaterial.map((candidate) => candidate.color).filter(Boolean))].sort(),
      materialMatchCount: materialMatches.length,
      colorMatchCount: colorMatches.length,
      candidateSpools: candidates,
      problemCode: order.problem_code,
      problemMessage: order.problem_message,
    };
  });
}
