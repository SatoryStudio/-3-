export function normalizeMarketplaceSku(value: string) {
  return String(value || "").trim().toLowerCase();
}
