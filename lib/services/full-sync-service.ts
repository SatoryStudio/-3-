import type { SyncPeriod } from "@/lib/integrations/marketplace-adapter";
import { YandexSyncService } from "@/lib/integrations/yandex-sync-service";
import { ProblemOrderService } from "@/lib/services/problem-order-service";
import {
  emptyFinanceReport,
  emptyOrderReport,
  skippedImportStep,
  type FinanceSyncReport,
  type FullSyncReport,
  type FullSyncStatus,
  type OrderSyncReport,
  type ProblemRetryReport,
  type SyncIssue,
} from "@/lib/services/sync-report";
import { SyncLogService } from "@/lib/services/sync-log-service";
import type { IntegrationSettingsService } from "@/lib/services/integration-settings-service";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import type { GoogleSheetsService } from "@/lib/services/google-sheets-service";

export class FullSyncService {
  private running = false;
  private currentStep = "";
  private currentRunId = "";
  private readonly logs: SyncLogService;
  private readonly problems: ProblemOrderService;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly integrations: IntegrationSettingsService,
    private readonly yandexFactory: () => Pick<YandexSyncService, "run"> = () =>
      new YandexSyncService(storage, integrations),
    private readonly google?: Pick<GoogleSheetsService, "sync">,
  ) {
    this.logs = new SyncLogService(storage);
    this.problems = new ProblemOrderService(storage);
  }

  async run(period: SyncPeriod): Promise<FullSyncReport> {
    if (this.running) throw Object.assign(new Error("Полная синхронизация уже выполняется"), { code: "SYNC_IN_PROGRESS" });
    this.running = true;
    const runId = crypto.randomUUID();
    this.currentRunId = runId;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    let yandexOrders = emptyOrderReport();
    let yandexStatuses = emptyOrderReport();
    let yandexFinance = emptyFinanceReport();
    let problemRetry = this.emptyRetry();
    let reserveCheck = this.emptyRetry();
    let profitRecalculated = 0;
    let mainYandexFailed = false;
    let technicalErrors = 0;

    try {
      await this.logs.append({
        runId,
        entryType: "run",
        source: "system",
        operation: "full_sync",
        status: "started",
        periodFrom: period.from,
        periodTo: period.to,
        startedAt,
      });
      const yandex = this.yandexFactory();
      let googleProducts = skippedImportStep();
      let googleFilament = skippedImportStep();
      if (this.google) {
        this.currentStep = "Синхронизация товаров Google Sheets";
        googleProducts = await this.google.sync("products");
        technicalErrors += googleProducts.errors;
        this.currentStep = "Синхронизация филамента Google Sheets";
        googleFilament = await this.google.sync("filament");
        technicalErrors += googleFilament.errors;
      }
      try {
        this.currentStep = "Повторная обработка problem-заказов";
        problemRetry = await this.problems.retryAll(runId);
        technicalErrors += problemRetry.errors;
      } catch {
        technicalErrors++;
        problemRetry = { ...this.emptyRetry(), status: "error", errors: 1 };
      }
      try {
        this.currentStep = "Синхронизация заказов Яндекс Маркета";
        yandexOrders = (await yandex.run("orders", period, { runId })).report as OrderSyncReport;
        technicalErrors += yandexOrders.errors;
      } catch {
        mainYandexFailed = true;
        technicalErrors++;
        yandexOrders = { ...emptyOrderReport(), status: "error", errors: 1 };
      }
      try {
        this.currentStep = "Синхронизация статусов Яндекс Маркета";
        yandexStatuses = (await yandex.run("statuses", period, { runId })).report as OrderSyncReport;
        technicalErrors += yandexStatuses.errors;
      } catch {
        technicalErrors++;
        yandexStatuses = { ...emptyOrderReport(), status: "error", errors: 1 };
      }
      try {
        this.currentStep = "Синхронизация финансов Яндекс Маркета";
        yandexFinance = (await yandex.run("finance", period, { runId })).report as FinanceSyncReport;
        technicalErrors += yandexFinance.errors;
      } catch {
        technicalErrors++;
        yandexFinance = { ...emptyFinanceReport(), status: "error", errors: 1 };
      }
      try {
        this.currentStep = "Проверка резервов филамента";
        reserveCheck = await this.problems.checkReservations(runId);
        technicalErrors += reserveCheck.errors;
      } catch {
        technicalErrors++;
        reserveCheck = { ...this.emptyRetry(), status: "error", errors: 1 };
      }
      try {
        this.currentStep = "Пересчёт прибыли";
        profitRecalculated = await this.problems.recalculateAffected();
      } catch {
        technicalErrors++;
        await this.logs.append({
          runId,
          entryType: "error",
          source: "finance",
          operation: "recalculate_profit",
          status: "error",
          errorCode: "STORAGE_ERROR",
          safeMessage: "Не удалось пересчитать прибыль",
        });
      }

      const database = await this.storage.read();
      const problemOrders = database.orders.filter((order) => order.internal_status === "problem").length;
      const usefulResults = yandexOrders.loaded > 0 || yandexStatuses.loaded > 0 || yandexFinance.loaded > 0;
      const report: FullSyncReport = {
        runId,
        status: this.calculateStatus(mainYandexFailed, usefulResults, technicalErrors, problemOrders),
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        googleProducts,
        googleFilament,
        yandexOrders,
        yandexStatuses,
        yandexFinance,
        problemRetry,
        reserveCheck,
        profitRecalculated,
        totals: {
          loadedOrders: yandexOrders.loaded,
          problemOrders,
          technicalErrors,
        },
      };
      await this.finishRun(report);
      return report;
    } finally {
      this.running = false;
      this.currentStep = "";
      this.currentRunId = "";
    }
  }

  status() {
    return {
      running: this.running,
      currentStep: this.currentStep,
      runId: this.currentRunId,
    };
  }

  async latest(): Promise<FullSyncReport | null> {
    const database = await this.storage.read();
    const log = [...database.sync_logs].reverse().find(
      (item) => item.entry_type === "run"
        && item.operation === "full_sync"
        && item.finished_at
        && item.summary,
    );
    if (!log) return null;
    try {
      return JSON.parse(log.summary) as FullSyncReport;
    } catch {
      return null;
    }
  }

  async issues(limit = 100): Promise<SyncIssue[]> {
    const database = await this.storage.read();
    return database.sync_logs
      .filter((log) => log.entry_type === "problem" || log.entry_type === "error")
      .slice(-Math.min(500, Math.max(1, limit)))
      .reverse()
      .map((log) => ({
        id: log.id,
        runId: log.run_id,
        entryType: log.entry_type as "problem" | "error",
        source: log.source,
        operation: log.operation,
        createdAt: log.created_at,
        orderId: log.order_id,
        sku: log.sku,
        code: log.error_code,
        message: log.safe_message,
      }));
  }

  private async finishRun(report: FullSyncReport) {
    await this.storage.transaction((unit) => {
      const log = [...unit.data.sync_logs].reverse().find(
        (item) => item.run_id === report.runId && item.entry_type === "run",
      );
      if (!log) return;
      log.status = report.status === "partial" || report.status === "failed" ? "error" : "success";
      log.finished_at = report.finishedAt;
      log.summary = JSON.stringify(report);
      log.error_code = report.status === "failed" ? "YANDEX_API_ERROR" : "";
      log.safe_message = report.status === "failed"
        ? "Полная синхронизация не получила данные Яндекс Маркета"
        : "";
      unit.touch("sync_logs");
    });
  }

  private calculateStatus(
    mainFailed: boolean,
    usefulResults: boolean,
    technicalErrors: number,
    problemOrders: number,
  ): FullSyncStatus {
    if (mainFailed && !usefulResults) return "failed";
    if (technicalErrors) return "partial";
    if (problemOrders) return "completed_with_problems";
    return "success";
  }

  private emptyRetry(): ProblemRetryReport {
    return { status: "success", attempted: 0, resolved: 0, remaining: 0, errors: 0 };
  }
}
