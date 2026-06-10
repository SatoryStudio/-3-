import { IntegrationConfigurationError } from "@/lib/services/integration-settings-service";

export type SafeIntegrationErrorCode =
  | "missing_settings"
  | "missing_api_key"
  | "invalid_key"
  | "missing_campaign"
  | "missing_business"
  | "business_mismatch"
  | "forbidden"
  | "rate_limit"
  | "api_error"
  | "unknown";

export class MarketplaceApiError extends Error {
  constructor(
    public readonly status: number,
    message = "Marketplace API error",
  ) {
    super(message);
  }
}

export function classifyIntegrationError(error: unknown): {
  code: SafeIntegrationErrorCode;
  message: string;
} {
  if (typeof error === "object" && error && "code" in error && error.code === "business_mismatch") {
    return { code: "business_mismatch", message: "Campaign ID не принадлежит указанному Business ID" };
  }
  if (error instanceof IntegrationConfigurationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof MarketplaceApiError) {
    if (error.status === 401) return { code: "invalid_key", message: "Ключ доступа отклонён" };
    if (error.status === 403) return { code: "forbidden", message: "Доступ к ресурсу запрещён" };
    if (error.status === 404) return { code: "missing_campaign", message: "Кампания или кабинет не найден" };
    if (error.status === 429) return { code: "rate_limit", message: "Превышен лимит запросов" };
    if (error.status >= 500) return { code: "api_error", message: "Маркетплейс временно недоступен" };
    return { code: "api_error", message: "Ошибка API маркетплейса" };
  }
  return { code: "unknown", message: "Неизвестная ошибка интеграции" };
}
