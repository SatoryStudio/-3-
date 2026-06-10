function base(value: string) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MATERIAL_ALIASES = new Map([
  ["pla", "pla basic"],
  ["pla base", "pla basic"],
  ["pla basic", "pla basic"],
  ["basic pla", "pla basic"],
  ["base pla", "pla basic"],
  ["petg", "petg basic"],
  ["petg base", "petg basic"],
  ["petg basic", "petg basic"],
  ["basic petg", "petg basic"],
  ["base petg", "petg basic"],
]);

const COLOR_ALIASES = new Map([
  ["black", "черный"],
  ["черный", "черный"],
  ["white", "белый"],
  ["белый", "белый"],
  ["red", "бордо"],
  ["бордо", "бордо"],
  ["burgundy", "бордо"],
  ["transparent", "прозрачный"],
  ["прозрачный", "прозрачный"],
  ["bordo", "бордо"],
  ["бардо", "бордо"],
  ["cherry", "вишневый"],
  ["вишевый", "вишневый"],
  ["вишневый", "вишневый"],
]);

export function normalizeFilamentMaterial(value: string) {
  const normalized = base(value);
  return MATERIAL_ALIASES.get(normalized) || normalized;
}

export function normalizeFilamentColor(value: string) {
  const normalized = base(value);
  return COLOR_ALIASES.get(normalized) || normalized;
}

export function filamentMatches(
  requiredMaterial: string,
  requiredColor: string,
  actualMaterial: string,
  actualColor: string,
) {
  return normalizeFilamentMaterial(requiredMaterial) === normalizeFilamentMaterial(actualMaterial)
    && normalizeFilamentColor(requiredColor) === normalizeFilamentColor(actualColor);
}
