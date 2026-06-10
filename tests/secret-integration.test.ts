import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationSettingsService } from "@/lib/services/integration-settings-service";
import { SecretService } from "@/lib/services/secret-service";
import { ExcelStorageAdapter } from "@/lib/storage/excel-storage-adapter";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function tempDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "filament-secrets-"));
  directories.push(directory);
  return directory;
}

describe("SecretService", () => {
  it("uses unique IVs, AAD and masks decrypted values", async () => {
    vi.stubEnv("APP_SECRET_KEY", "test-master-key");
    const service = new SecretService(await tempDirectory());
    const first = await service.encrypt("secret-value-1234", "ozon:api_key");
    const second = await service.encrypt("secret-value-1234", "ozon:api_key");
    expect(first).not.toBe(second);
    expect(await service.decrypt(first, "ozon:api_key")).toBe("secret-value-1234");
    await expect(service.decrypt(first, "yandex_market:api_key")).rejects.toThrow();
    expect(service.mask("secret-value-1234")).toBe("secr...1234");
  });

  it("rejects ciphertext with another master key", async () => {
    const directory = await tempDirectory();
    vi.stubEnv("APP_SECRET_KEY", "first-key");
    const encrypted = await new SecretService(directory).encrypt("secret", "ozon:api_key");
    vi.stubEnv("APP_SECRET_KEY", "second-key");
    await expect(new SecretService(directory).decrypt(encrypted, "ozon:api_key")).rejects.toThrow();
  });
});

describe("IntegrationSettingsService", () => {
  it("stores ciphertext and returns only masks", async () => {
    vi.stubEnv("APP_SECRET_KEY", "integration-test-key");
    const directory = await tempDirectory();
    const storage = new ExcelStorageAdapter(directory);
    const service = new IntegrationSettingsService(storage, new SecretService(directory));
    await service.save("ozon", { client_id: "client-1234", api_key: "plain-secret-5678" });

    const database = await storage.read();
    expect(database.integration_settings).toHaveLength(2);
    expect(database.integration_settings.map((item) => item.value_encrypted).join(" "))
      .not.toContain("plain-secret-5678");
    expect(JSON.stringify(await service.getMasked("ozon"))).not.toContain("plain-secret-5678");
    expect((await service.getMasked("ozon")).fields.api_key.mask).toBe("plai...5678");
    expect(await service.getOzonCredentials()).toEqual({
      clientId: "client-1234",
      apiKey: "plain-secret-5678",
    });
  });

  it("persists Yandex settings, exposes safe status and supports partial updates", async () => {
    vi.stubEnv("APP_SECRET_KEY", "yandex-integration-test-key");
    const directory = await tempDirectory();
    const storage = new ExcelStorageAdapter(directory);
    const service = new IntegrationSettingsService(storage, new SecretService(directory));

    const saved = await service.saveProviderSettings("yandex_market", {
      api_key: "yandex-secret-1234",
      campaign_id: "00123456",
      business_id: "00987654",
    });

    expect(saved.configured).toBe(true);
    expect(saved.fields.api_key.displayValue).toBe("yand...1234");
    expect(saved.fields.campaign_id.displayValue).toBe("00123456");
    expect(saved.fields.business_id.displayValue).toBe("00987654");
    expect(saved.lastSavedAt).not.toBe("");

    const reloaded = new IntegrationSettingsService(
      new ExcelStorageAdapter(directory),
      new SecretService(directory),
    );
    expect(await reloaded.getYandexCredentials()).toMatchObject({
      apiKey: "yandex-secret-1234",
      campaignId: "00123456",
      businessId: "00987654",
    });

    await reloaded.saveProviderSettings("yandex_market", { campaign_id: "00123457" });
    expect(await reloaded.getYandexCredentials()).toMatchObject({
      apiKey: "yandex-secret-1234",
      campaignId: "00123457",
      businessId: "00987654",
    });

    const database = await storage.read();
    expect(database.sync_logs.filter((log) => log.operation === "save_settings")).toHaveLength(2);
    expect(JSON.stringify(database.sync_logs)).not.toContain("yandex-secret-1234");
    expect(JSON.stringify(saved)).not.toContain("yandex-secret-1234");
  });

  it("requires API Key, Campaign ID and Business ID for Yandex", async () => {
    vi.stubEnv("APP_SECRET_KEY", "required-fields-test-key");
    const directory = await tempDirectory();
    const service = new IntegrationSettingsService(
      new ExcelStorageAdapter(directory),
      new SecretService(directory),
    );

    await expect(service.saveProviderSettings("yandex_market", {
      api_key: "key",
      campaign_id: "42",
    })).rejects.toMatchObject({ code: "missing_business" });
  });
});
