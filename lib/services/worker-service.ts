import { OzonSyncService } from "@/lib/integrations/ozon-sync-service";
import type { SyncPeriod } from "@/lib/integrations/marketplace-adapter";
import { YandexSyncService } from "@/lib/integrations/yandex-sync-service";
import { getSettings, setSetting } from "@/lib/services/settings-service";
import type { IntegrationSettingsService } from "@/lib/services/integration-settings-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import type { GoogleSheetsService } from "@/lib/services/google-sheets-service";

export type WorkerTask = "orders" | "statuses" | "finance" | "google_products" | "google_filament";
type WorkerState = "running" | "stopped" | "error";

export class WorkerService {
  private timers = new Map<WorkerTask, NodeJS.Timeout>();
  private active = new Set<string>();
  private restored = false;
  private state: WorkerState = "stopped";
  private lastRun = "";
  private lastError = "";

  constructor(
    private readonly storage: StorageAdapter,
    private readonly integrations: IntegrationSettingsService,
    private readonly google?: Pick<GoogleSheetsService, "sync">,
  ) {}

  async restore() {
    if (this.restored) return this.status();
    this.restored = true;
    const settings = getSettings(await this.storage.read());
    if (settings.workerEnabled) await this.start(false);
    return this.status();
  }

  async start(persist = true) {
    this.clearTimers();
    const settings = getSettings(await this.storage.read());
    this.schedule("orders", settings.workerOrdersIntervalMinutes);
    this.schedule("statuses", settings.workerStatusesIntervalMinutes);
    this.schedule("finance", settings.workerFinanceIntervalMinutes);
    this.schedule("google_products", settings.workerGoogleProductsIntervalMinutes);
    this.schedule("google_filament", settings.workerGoogleFilamentIntervalMinutes);
    this.state = "running";
    this.lastError = "";
    if (persist) {
      await this.setEnabled(true);
      await this.logControl("start", "Worker запущен");
    }
    return this.status();
  }

  async stop(persist = true) {
    this.clearTimers();
    this.state = "stopped";
    if (persist) {
      await this.setEnabled(false);
      await this.logControl("stop", "Worker остановлен");
    }
    return this.status();
  }

  async restart() {
    await this.stop(false);
    await this.start(false);
    await this.setEnabled(true);
    await this.logControl("restart", "Worker перезапущен");
    return this.status();
  }

  async updateIntervals(values: Partial<Record<WorkerTask, number>>) {
    await this.storage.transaction((unit) => {
      if (values.orders !== undefined) setSetting(unit.data, "workerOrdersIntervalMinutes", this.interval(values.orders), "number");
      if (values.statuses !== undefined) setSetting(unit.data, "workerStatusesIntervalMinutes", this.interval(values.statuses), "number");
      if (values.finance !== undefined) setSetting(unit.data, "workerFinanceIntervalMinutes", this.interval(values.finance), "number");
      if (values.google_products !== undefined) setSetting(unit.data, "workerGoogleProductsIntervalMinutes", this.interval(values.google_products), "number");
      if (values.google_filament !== undefined) setSetting(unit.data, "workerGoogleFilamentIntervalMinutes", this.interval(values.google_filament), "number");
      unit.touch("settings");
    });
    if (this.state === "running") await this.restart();
    else await this.logControl("intervals", "Интервалы worker обновлены");
    return this.status();
  }

  async runNow(task: WorkerTask | "all") {
    const tasks: WorkerTask[] = task === "all"
      ? ["google_products", "google_filament", "orders", "statuses", "finance"]
      : [task];
    for (const current of tasks) await this.runTask(current);
    await this.logControl("run_now", `Ручной запуск: ${task}`);
    return this.status();
  }

  async status() {
    const settings = getSettings(await this.storage.read());
    return {
      state: this.state,
      enabled: settings.workerEnabled,
      intervals: {
        orders: settings.workerOrdersIntervalMinutes,
        statuses: settings.workerStatusesIntervalMinutes,
        finance: settings.workerFinanceIntervalMinutes,
        google_products: settings.workerGoogleProductsIntervalMinutes,
        google_filament: settings.workerGoogleFilamentIntervalMinutes,
      },
      active: [...this.active],
      lastRun: this.lastRun,
      lastError: this.lastError,
    };
  }

  private schedule(task: WorkerTask, minutes: number) {
    const timer = setInterval(() => void this.runTask(task), this.interval(minutes) * 60_000);
    timer.unref();
    this.timers.set(task, timer);
  }

  private async runTask(task: WorkerTask) {
    if (task === "google_products" || task === "google_filament") {
      const key = `google:${task}`;
      if (this.active.has(key) || !this.google) return;
      this.active.add(key);
      try {
        await this.google.sync(task === "google_products" ? "products" : "filament");
        this.lastRun = new Date().toISOString();
        this.lastError = "";
      } catch (error) {
        this.state = "error";
        this.lastError = error instanceof Error ? error.message : "Ошибка Google Sheets";
      } finally {
        this.active.delete(key);
      }
      return;
    }
    const providers = [
      { code: "yandex", configured: await this.integrations.isConfigured("yandex_market") },
      { code: "ozon", configured: await this.integrations.isConfigured("ozon") },
    ].filter((item) => item.configured);
    const period = this.period(task === "orders" ? 7 : 30);
    for (const provider of providers) {
      const key = `${provider.code}:${task}`;
      if (this.active.has(key)) continue;
      this.active.add(key);
      try {
        const service = provider.code === "yandex"
          ? new YandexSyncService(this.storage, this.integrations)
          : new OzonSyncService(this.storage, this.integrations);
        await service.run(task, period);
        this.lastRun = new Date().toISOString();
        this.lastError = "";
      } catch (error) {
        this.state = "error";
        this.lastError = error instanceof Error ? error.message : "Ошибка worker";
      } finally {
        this.active.delete(key);
      }
    }
  }

  private clearTimers() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers.clear();
  }

  private interval(value: number) {
    const normalized = Math.round(Number(value));
    if (!Number.isFinite(normalized) || normalized < 1) throw new Error("Интервал должен быть не меньше одной минуты");
    return normalized;
  }

  private period(days: number): SyncPeriod {
    const to = new Date();
    return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() };
  }

  private async setEnabled(enabled: boolean) {
    await this.storage.transaction((unit) => {
      setSetting(unit.data, "workerEnabled", enabled, "boolean");
      unit.touch("settings");
    });
  }

  private async logControl(operation: string, message: string) {
    const now = new Date().toISOString();
    await this.storage.transaction((unit) => {
      unit.data.sync_logs.push({
        id: crypto.randomUUID(),
        run_id: "",
        entry_type: "step",
        source: "worker",
        operation,
        status: "success",
        started_at: now,
        finished_at: now,
        summary: message,
        error_code: "",
        safe_message: "",
        order_id: "",
        sku: "",
        period_from: "",
        period_to: "",
        created_at: now,
      });
      unit.touch("sync_logs");
    });
  }
}
