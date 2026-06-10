import { getSettings, setSetting } from "@/lib/services/settings-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

export type TunnelProvider = "none" | "manual";

export class TunnelService {
  constructor(private readonly storage: StorageAdapter) {}

  async read() {
    const settings = getSettings(await this.storage.read());
    return {
      provider: settings.tunnelProvider as TunnelProvider,
      publicUrl: settings.tunnelPublicUrl,
    };
  }

  async update(input: { provider: string; publicUrl?: string }) {
    if (!["none", "manual"].includes(input.provider)) throw new Error("Этот режим туннеля пока недоступен");
    const publicUrl = String(input.publicUrl || "").trim().replace(/\/+$/, "");
    if (input.provider === "manual") this.validateHttpsUrl(publicUrl);
    await this.storage.transaction((unit) => {
      setSetting(unit.data, "tunnelProvider", input.provider, "string");
      setSetting(unit.data, "tunnelPublicUrl", input.provider === "manual" ? publicUrl : "", "string");
      unit.touch("settings");
    });
    return this.read();
  }

  async test() {
    const settings = await this.read();
    if (settings.provider !== "manual") return { ok: false, code: "not_configured", message: "Туннель не настроен" };
    try {
      this.validateHttpsUrl(settings.publicUrl);
    } catch {
      return { ok: false, code: "invalid_url", message: "Укажите корректный публичный HTTPS URL" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${settings.publicUrl}/api/health`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.status !== "ok") {
        return { ok: false, code: "invalid_response", message: "Адрес отвечает, но это не Filament ERP" };
      }
      return { ok: true, code: "working", message: "Публичный адрес работает" };
    } catch (error) {
      if ((error as Error).name === "AbortError") return { ok: false, code: "unreachable", message: "Превышено время ожидания" };
      const message = String((error as Error).message || "").toLowerCase();
      if (message.includes("certificate") || message.includes("ssl") || message.includes("tls")) {
        return { ok: false, code: "ssl_error", message: "Ошибка SSL-сертификата" };
      }
      return { ok: false, code: "unreachable", message: "Публичный адрес недоступен" };
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateHttpsUrl(value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
  }
}
