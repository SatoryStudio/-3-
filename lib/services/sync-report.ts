import type { SyncProblemCode, SyncTechnicalErrorCode } from "@/lib/domain/types";

export type SyncStepStatus = "success" | "completed_with_problems" | "skipped" | "error";
export type FullSyncStatus = "success" | "completed_with_problems" | "partial" | "failed";

export interface ImportStepReport {
  status: SyncStepStatus;
  reason?: "not_configured" | "oauth_not_connected" | "dependency_failed";
  source: "google_api" | "public_csv" | "none";
  rowsRead: number;
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  sourceWeightGrams: number;
  erpInitialWeightGrams: number;
  erpRemainingWeightGrams: number;
  weightDifferenceGrams: number;
  activeSpools: number;
  archivedSpools: number;
  warnings: string[];
  rowErrors: Array<{
    row: number;
    field: string;
    value: string;
    reason: string;
    material?: string;
    color?: string;
    weight?: string;
    price?: string;
  }>;
}

export interface OrderSyncReport {
  status: SyncStepStatus;
  loaded: number;
  created: number;
  updated: number;
  productionLocked: number;
  problem: number;
  errors: number;
}

export interface FinanceSyncReport {
  status: SyncStepStatus;
  loaded: number;
  matched: number;
  unmatched: number;
  errors: number;
}

export interface ProblemRetryReport {
  status: SyncStepStatus;
  attempted: number;
  resolved: number;
  remaining: number;
  errors: number;
}

export interface SyncIssue {
  id: string;
  runId: string;
  entryType: "problem" | "error";
  source: string;
  operation: string;
  createdAt: string;
  orderId: string;
  sku: string;
  code: SyncProblemCode | SyncTechnicalErrorCode | string;
  message: string;
}

export interface FullSyncReport {
  runId: string;
  status: FullSyncStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  googleProducts: ImportStepReport;
  googleFilament: ImportStepReport;
  yandexOrders: OrderSyncReport;
  yandexStatuses: OrderSyncReport;
  yandexFinance: FinanceSyncReport;
  problemRetry: ProblemRetryReport;
  reserveCheck: ProblemRetryReport;
  profitRecalculated: number;
  totals: {
    loadedOrders: number;
    problemOrders: number;
    technicalErrors: number;
  };
}

export const skippedImportStep = (): ImportStepReport => ({
  status: "skipped",
  reason: "not_configured",
  source: "none",
  rowsRead: 0,
  imported: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
  sourceWeightGrams: 0,
  erpInitialWeightGrams: 0,
  erpRemainingWeightGrams: 0,
  weightDifferenceGrams: 0,
  activeSpools: 0,
  archivedSpools: 0,
  warnings: [],
  rowErrors: [],
});

export const emptyOrderReport = (): OrderSyncReport => ({
  status: "success",
  loaded: 0,
  created: 0,
  updated: 0,
  productionLocked: 0,
  problem: 0,
  errors: 0,
});

export const emptyFinanceReport = (): FinanceSyncReport => ({
  status: "success",
  loaded: 0,
  matched: 0,
  unmatched: 0,
  errors: 0,
});
