import type { IntegrationSetting } from "@/lib/domain/types";
import { SecretService } from "@/lib/services/secret-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

export type IntegrationProvider = "yandex_market" | "ozon" | "google_sheets";
export type IntegrationSettingKey =
  | "api_key"
  | "campaign_id"
  | "business_id"
  | "oauth_token"
  | "client_id"
  | "client_secret"
  | "refresh_token"
  | "products_sheet_url"
  | "filament_sheet_url";

export interface IntegrationFieldStatus {
  configured: boolean;
  mask: string;
  displayValue: string;
  readable: boolean;
}

export interface IntegrationSettingsStatus {
  provider: IntegrationProvider;
  configured: boolean;
  fields: Record<string, IntegrationFieldStatus>;
  lastSavedAt: string;
}

export interface YandexCredentials {
  apiKey: string;
  campaignId: string;
  businessId: string;
  oauthToken: string;
}

export interface OzonCredentials {
  clientId: string;
  apiKey: string;
}

const PROVIDER_FIELDS = {
  yandex_market: ["api_key", "campaign_id", "business_id", "oauth_token"],
  ozon: ["client_id", "api_key"],
  google_sheets: [
    "client_id", "client_secret", "refresh_token", "products_sheet_url", "filament_sheet_url",
  ],
} as const;

const REQUIRED_FIELDS: Record<IntegrationProvider, readonly string[]> = {
  yandex_market: ["api_key", "campaign_id", "business_id"],
  ozon: ["client_id", "api_key"],
  google_sheets: ["client_id", "client_secret"],
};

const SECRET_FIELDS = new Set(["api_key", "oauth_token", "client_secret", "refresh_token"]);

const ENV_FIELDS: Record<IntegrationProvider, Record<string, string | undefined>> = {
  yandex_market: {
    api_key: process.env.YANDEX_API_KEY,
    campaign_id: process.env.YANDEX_CAMPAIGN_ID,
    business_id: process.env.YANDEX_BUSINESS_ID,
    oauth_token: process.env.YANDEX_OAUTH_TOKEN,
  },
  ozon: {
    client_id: process.env.OZON_CLIENT_ID,
    api_key: process.env.OZON_API_KEY,
  },
  google_sheets: {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    products_sheet_url: process.env.GOOGLE_PRODUCTS_SHEET_URL,
    filament_sheet_url: process.env.GOOGLE_FILAMENT_SHEET_URL,
  },
};

export class IntegrationSettingsService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly secrets: SecretService,
  ) {}

  async getProviderSettingsStatus(provider: IntegrationProvider): Promise<IntegrationSettingsStatus> {
    await this.migrateEnvironment(provider);
    const database = await this.storage.read();
    const rows = database.integration_settings.filter((item) => item.provider === provider);
    const fields = Object.fromEntries(await Promise.all(PROVIDER_FIELDS[provider].map(async (key) => {
      const row = rows.find((item) => item.key === key);
      if (!row) {
        return [key, { configured: false, mask: "", displayValue: "", readable: true }];
      }
      try {
        const value = await this.secrets.decrypt(row.value_encrypted, `${provider}:${key}`);
        const displayValue = SECRET_FIELDS.has(key) ? this.secrets.mask(value) : value;
        return [key, {
          configured: true,
          mask: displayValue,
          displayValue,
          readable: true,
        }];
      } catch {
        return [key, {
          configured: true,
          mask: "не читается",
          displayValue: "не читается",
          readable: false,
        }];
      }
    })));
    const requiredFields = REQUIRED_FIELDS[provider];
    return {
      provider,
      configured: requiredFields.every((key) => fields[key]?.configured && fields[key]?.readable),
      fields,
      lastSavedAt: rows.reduce((latest, row) =>
        row.updated_at > latest ? row.updated_at : latest, ""),
    };
  }

  async getMasked(provider: IntegrationProvider) {
    return this.getProviderSettingsStatus(provider);
  }

  async saveProviderSettings(provider: IntegrationProvider, values: Record<string, unknown>) {
    const allowed = new Set<string>(PROVIDER_FIELDS[provider]);
    const supplied = Object.entries(values)
      .filter(([key, value]) => allowed.has(key) && String(value || "").trim())
      .map(([key, value]) => [key, String(value).trim()] as const);
    if (provider === "google_sheets") {
      for (const [key, value] of supplied) {
        if (!key.endsWith("_sheet_url")) continue;
        let url: URL;
        try { url = new URL(value); } catch { throw new Error("Укажите корректный URL Google Sheets"); }
        if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !url.pathname.includes("/spreadsheets/d/")) {
          throw new Error("Разрешены только HTTPS-ссылки Google Sheets");
        }
      }
    }
    const existing = await this.getDecryptedProviderSettings(provider, false);
    const merged = { ...existing, ...Object.fromEntries(supplied) };
    const missing = REQUIRED_FIELDS[provider].filter((key) => !merged[key]);
    if (missing.length) throw new IntegrationConfigurationError(missingFieldCode(missing[0]));
    if (!supplied.length) return this.getProviderSettingsStatus(provider);

    const encrypted = await Promise.all(supplied.map(async ([key, value]) => ({
      key,
      value: await this.secrets.encrypt(value, `${provider}:${key}`),
    })));
    await this.storage.transaction((unit) => {
      const now = new Date().toISOString();
      for (const item of encrypted) {
        const existing = unit.data.integration_settings.find((row) =>
          row.provider === provider && row.key === item.key);
        if (existing) {
          existing.value_encrypted = item.value;
          existing.updated_at = now;
        } else {
          unit.data.integration_settings.push({
            id: crypto.randomUUID(),
            provider,
            key: item.key,
            value_encrypted: item.value,
            created_at: now,
            updated_at: now,
          });
        }
      }
      unit.data.sync_logs.push({
        id: crypto.randomUUID(),
        run_id: "",
        entry_type: "step",
        source: provider === "yandex_market" ? "yandex" : provider,
        operation: "save_settings",
        status: "success",
        started_at: now,
        finished_at: now,
        summary: "Настройки интеграции сохранены",
        error_code: "",
        safe_message: "",
        order_id: "",
        sku: "",
        period_from: "",
        period_to: "",
        created_at: now,
      });
      unit.touch("integration_settings", "sync_logs");
    });
    return this.getProviderSettingsStatus(provider);
  }

  async save(provider: IntegrationProvider, values: Record<string, unknown>) {
    return this.saveProviderSettings(provider, values);
  }

  async deleteProviderSettings(provider: IntegrationProvider) {
    await this.storage.transaction((unit) => {
      unit.data.integration_settings = unit.data.integration_settings.filter((item) => item.provider !== provider);
      unit.touch("integration_settings");
    });
  }

  async delete(provider: IntegrationProvider) {
    return this.deleteProviderSettings(provider);
  }

  async isConfigured(provider: IntegrationProvider) {
    const masked = await this.getProviderSettingsStatus(provider);
    return masked.configured;
  }

  async getYandexCredentials(): Promise<YandexCredentials> {
    const values = await this.getDecryptedProviderSettings("yandex_market");
    return {
      apiKey: values.api_key || "",
      campaignId: values.campaign_id || "",
      businessId: values.business_id || "",
      oauthToken: values.oauth_token || "",
    };
  }

  async getOzonCredentials(): Promise<OzonCredentials> {
    const values = await this.getDecryptedProviderSettings("ozon");
    return { clientId: values.client_id, apiKey: values.api_key };
  }

  async getGoogleSettings(validate = false) {
    return this.getDecryptedProviderSettings("google_sheets", validate);
  }

  async getDecryptedProviderSettings(
    provider: IntegrationProvider,
    validate = true,
  ): Promise<Record<string, string>> {
    if (validate) await this.migrateEnvironment(provider);
    const database = await this.storage.read();
    const rows = database.integration_settings.filter((item) => item.provider === provider);
    const values = Object.fromEntries(await Promise.all(rows.map(async (row) => [
      row.key,
      await this.secrets.decrypt(row.value_encrypted, `${provider}:${row.key}`),
    ]))) as Record<string, string>;
    if (validate) {
      const missing = REQUIRED_FIELDS[provider].find((key) => !values[key]);
      if (missing) throw new IntegrationConfigurationError(missingFieldCode(missing));
    }
    return values;
  }

  private async migrateEnvironment(provider: IntegrationProvider) {
    const database = await this.storage.read();
    if (database.integration_settings.some((item) => item.provider === provider)) return;
    const values = ENV_FIELDS[provider];
    if (!Object.values(values).some(Boolean)) return;
    await this.saveProviderSettings(provider, values);
  }
}

export class IntegrationConfigurationError extends Error {
  constructor(
    public readonly code:
      | "missing_settings"
      | "missing_api_key"
      | "missing_campaign"
      | "missing_business",
  ) {
    super({
      missing_api_key: "API Key не указан",
      missing_campaign: "Campaign ID не указан",
      missing_business: "Business ID не указан",
      missing_settings: "Настройки интеграции не заполнены",
    }[code]);
  }
}

function missingFieldCode(field: string): IntegrationConfigurationError["code"] {
  if (field === "api_key") return "missing_api_key";
  if (field === "campaign_id") return "missing_campaign";
  if (field === "business_id") return "missing_business";
  return "missing_settings";
}

export function integrationRowKey(row: IntegrationSetting) {
  return `${row.provider}:${row.key}`;
}
