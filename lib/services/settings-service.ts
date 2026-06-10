import type { Database } from "@/lib/domain/types";

export function getSettings(database: Database) {
  const values = Object.fromEntries(database.settings.map((item) => [item.key, item.value]));
  return {
    defaultPackagingCost: Number(values.defaultPackagingCost || 0),
    defaultElectricityCost: Number(values.defaultElectricityCost || 0),
    warningFilamentLevel: Number(values.warningFilamentLevel || 300),
    criticalFilamentLevel: Number(values.criticalFilamentLevel || 100),
    tunnelProvider: String(values.tunnelProvider || "none"),
    tunnelPublicUrl: String(values.tunnelPublicUrl || ""),
    workerEnabled: String(values.workerEnabled) === "true",
    workerOrdersIntervalMinutes: Number(values.workerOrdersIntervalMinutes || 5),
    workerStatusesIntervalMinutes: Number(values.workerStatusesIntervalMinutes || 60),
    workerFinanceIntervalMinutes: Number(values.workerFinanceIntervalMinutes || 1440),
    workerGoogleProductsIntervalMinutes: Number(values.workerGoogleProductsIntervalMinutes || 15),
    workerGoogleFilamentIntervalMinutes: Number(values.workerGoogleFilamentIntervalMinutes || 15),
  };
}

export function setSetting(
  database: Database,
  key: string,
  value: string | number | boolean,
  valueType: "number" | "boolean" | "string",
) {
  const now = new Date().toISOString();
  const existing = database.settings.find((item) => item.key === key);
  if (existing) {
    existing.value = String(value);
    existing.value_type = valueType;
    existing.updated_at = now;
  } else {
    database.settings.push({ key, value: String(value), value_type: valueType, updated_at: now });
  }
}
