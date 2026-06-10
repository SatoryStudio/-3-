import type { MarketplaceCode, Product } from "@/lib/domain/types";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { IntegrationSettingsService } from "@/lib/services/integration-settings-service";
import { normalizeMarketplaceSku } from "@/lib/services/sku-normalization";
import { inventoryService } from "@/lib/services/inventory-service";
import { ProblemOrderService } from "@/lib/services/problem-order-service";
import { SyncLogService } from "@/lib/services/sync-log-service";
import type { ImportStepReport } from "@/lib/services/sync-report";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

export interface GoogleSheetTarget {
  url: string;
  spreadsheetId: string;
  gid: number;
}

export function getGoogleOAuthRedirectUri(
  appUrl = process.env.APP_URL,
  environment = process.env.NODE_ENV,
) {
  const resolvedAppUrl = appUrl?.trim()
    || (environment !== "production" ? "http://localhost:3000" : "");
  if (!resolvedAppUrl) throw new Error("APP_URL не настроен");
  let url: URL;
  try { url = new URL(resolvedAppUrl); } catch { throw new Error("APP_URL должен быть корректным абсолютным URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("APP_URL должен использовать HTTP или HTTPS");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("Публичный APP_URL должен использовать HTTPS");
  }
  url.pathname = "/api/google/oauth/callback";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function maskOAuthClientId(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= 12) return `${normalized.slice(0, 4)}...`;
  return `${normalized.slice(0, 8)}...${normalized.slice(-8)}`;
}

export function parseGoogleSheetUrl(value: string): GoogleSheetTarget {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Укажите корректный URL Google Sheets"); }
  if (url.protocol !== "https:" || !["docs.google.com", "sheets.google.com"].includes(url.hostname)) {
    throw new Error("Разрешены только HTTPS-ссылки Google Sheets");
  }
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error("Не удалось определить ID Google-таблицы");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const gid = Number(url.searchParams.get("gid") || hash.get("gid") || 0);
  return { url: url.toString(), spreadsheetId: match[1], gid: Number.isFinite(gid) ? gid : 0 };
}

type SheetRow = { rowNumber: number; values: Record<string, string> };
type GoogleReadSource = {
  source: "google_api" | "public_csv";
  rows: SheetRow[];
  token?: string;
  spreadsheetId: string;
  gid: number;
  title?: string;
};

class RowValidationError extends Error {
  constructor(
    readonly field: string,
    readonly value: string,
    message: string,
  ) {
    super(message);
  }
}

export interface GoogleSheetStatus {
  configured: boolean;
  accessible: boolean | null;
  canSync: boolean;
  url: string;
  lastSuccessfulSyncAt: string;
  importedCount: number;
  created: number;
  updated: number;
  errors: number;
  source: "google_api" | "public_csv" | "none";
  rowsRead: number;
  imported: number;
  skipped: number;
  sourceWeightGrams: number;
  erpInitialWeightGrams: number;
  erpRemainingWeightGrams: number;
  weightDifferenceGrams: number;
  activeSpools: number;
  archivedSpools: number;
  warnings: string[];
  lastError: string;
}

export class GoogleSheetsService {
  private readonly logs: SyncLogService;
  constructor(
    private readonly storage: StorageAdapter,
    private readonly settings: IntegrationSettingsService,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.logs = new SyncLogService(storage);
  }

  async status() {
    const values = await this.settings.getGoogleSettings(false);
    const settingsStatus = await this.settings.getProviderSettingsStatus("google_sheets");
    const database = await this.storage.read();
    let callbackUrl = "";
    let appUrlError = "";
    try { callbackUrl = getGoogleOAuthRedirectUri(); }
    catch (error) { appUrlError = error instanceof Error ? error.message : "APP_URL настроен неверно"; }
    const credentialsConfigured = Boolean(values.client_id && values.client_secret);
    const connected = Boolean(values.refresh_token);
    const oauthLogs = database.sync_logs.filter(
      (log) => log.source === "google_sheets" && log.operation === "google_oauth_callback",
    );
    const latestOAuth = oauthLogs.at(-1);
    return {
      credentialsConfigured,
      connected,
      oauth: {
        credentialsConfigured,
        connected,
        status: connected ? "connected" : credentialsConfigured ? "not_connected" : "not_configured",
        lastError: latestOAuth?.status === "error" ? latestOAuth.safe_message : "",
      },
      callbackUrl,
      appUrl: process.env.APP_URL?.trim()
        || (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : ""),
      appUrlConfigured: Boolean(callbackUrl),
      appUrlError,
      clientIdMask: settingsStatus.fields.client_id?.configured
        ? maskOAuthClientId(values.client_id)
        : "",
      scopes: [...GOOGLE_OAUTH_SCOPES],
      environment: process.env.NODE_ENV || "development",
      products: this.targetStatus({
        url: values.products_sheet_url,
        operation: "sync_google_products",
        logs: database.sync_logs,
        importedCount: database.products.filter((product) => product.is_active).length,
        oauthConnected: connected,
      }),
      filament: this.targetStatus({
        url: values.filament_sheet_url,
        operation: "sync_google_filament",
        logs: database.sync_logs,
        importedCount: database.filament_spools.filter((spool) => spool.status !== "archived").length,
        oauthConnected: connected,
      }),
    };
  }

  async authorizationUrl(state: string) {
    const values = await this.settings.getGoogleSettings(true);
    const redirectUri = getGoogleOAuthRedirectUri();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", values.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    await this.logs.append({
      entryType: "step",
      source: "google_sheets",
      operation: "google_oauth_start",
      status: "success",
      summary: JSON.stringify({
        client_id_mask: maskOAuthClientId(values.client_id),
        redirect_uri: redirectUri,
        scopes: GOOGLE_OAUTH_SCOPES,
        state_created: Boolean(state),
      }),
    });
    return url.toString();
  }

  async exchangeCode(code: string) {
    const values = await this.settings.getGoogleSettings(true);
    const redirectUri = getGoogleOAuthRedirectUri();
    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: values.client_id,
        client_secret: values.client_secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.refresh_token) throw new Error("Google не вернул refresh token. Повторите подключение.");
    await this.settings.saveProviderSettings("google_sheets", { refresh_token: payload.refresh_token });
  }

  async disconnect() {
    const values = await this.settings.getGoogleSettings(false);
    if (values.refresh_token) {
      await this.fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(values.refresh_token)}`, {
        method: "POST",
      }).catch(() => undefined);
    }
    await this.storage.transaction((unit) => {
      unit.data.integration_settings = unit.data.integration_settings.filter(
        (row) => !(row.provider === "google_sheets" && row.key === "refresh_token"),
      );
      unit.touch("integration_settings");
    });
  }

  async sync(type: "products" | "filament"): Promise<ImportStepReport> {
    const operation = type === "products" ? "sync_google_products" : "sync_google_filament";
    const startedAt = new Date().toISOString();
    try {
      const values = await this.settings.getGoogleSettings(false);
      const rawUrl = values[type === "products" ? "products_sheet_url" : "filament_sheet_url"];
      if (!rawUrl) {
        return {
          status: "skipped", reason: "not_configured", source: "none", rowsRead: 0,
          imported: 0, created: 0, updated: 0, skipped: 0, errors: 0,
          sourceWeightGrams: 0, erpInitialWeightGrams: 0, erpRemainingWeightGrams: 0,
          weightDifferenceGrams: 0, activeSpools: 0, archivedSpools: 0, warnings: [], rowErrors: [],
        };
      }
      const target = parseGoogleSheetUrl(rawUrl);
      const source = await this.readWithFallback(values, target);
      const report = type === "products"
        ? await this.syncProducts(source.rows, source.source)
        : await this.syncFilament(source);
      await this.log(operation, report, startedAt);
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка Google Sheets";
      const report: ImportStepReport = {
        status: "error", source: "none", rowsRead: 0, imported: 0, created: 0, updated: 0,
        skipped: 1, errors: 1, sourceWeightGrams: 0, erpInitialWeightGrams: 0,
        erpRemainingWeightGrams: 0, weightDifferenceGrams: 0, activeSpools: 0,
        archivedSpools: 0, warnings: [],
        rowErrors: [{ row: 0, field: "", value: "", reason: message }],
      };
      await this.logs.append({
        entryType: "error", source: "google_sheets", operation, status: "error",
        errorCode: "GOOGLE_SHEETS_UNAVAILABLE", safeMessage: message,
        startedAt,
      });
      return report;
    }
  }

  async recordOAuthCallback(status: "success" | "error", errorCode = "", safeMessage = "") {
    await this.logs.append({
      entryType: status === "error" ? "error" : "step",
      source: "google_sheets",
      operation: "google_oauth_callback",
      status,
      errorCode,
      safeMessage,
      summary: status === "success" ? "Google OAuth подключён" : "",
    });
  }

  private async syncProducts(
    rows: SheetRow[],
    source: GoogleReadSource["source"],
  ): Promise<ImportStepReport> {
    let created = 0;
    let updated = 0;
    const rowErrors: ImportStepReport["rowErrors"] = [];
    await this.storage.transaction((unit) => {
      const seen = new Set<string>();
      rows.forEach((row) => {
        try {
          const valuesRow = this.productRow(row.values);
          const marketplace = String(valuesRow.marketplace || "yandex").trim().toLowerCase() as MarketplaceCode;
          const sku = String(valuesRow.marketplace_sku || "").trim();
          const normalizedSku = normalizeMarketplaceSku(sku);
          if (!["manual", "yandex", "ozon"].includes(marketplace)) {
            throw new RowValidationError("marketplace", marketplace, "Неизвестный marketplace");
          }
          if (!sku) throw new RowValidationError("marketplace_sku", sku, "Артикул обязателен");
          if (!valuesRow.name) throw new RowValidationError("name", "", "Название обязательно");
          const key = `${marketplace}:${normalizedSku}`;
          seen.add(key);
          const now = new Date().toISOString();
          const existing = unit.data.products.find((item) => item.marketplace === marketplace && normalizeMarketplaceSku(item.marketplace_sku) === normalizedSku);
          const values: Omit<Product, "id" | "created_at"> = {
            marketplace, marketplace_sku: sku, name: valuesRow.name.trim(),
            filament_material: String(valuesRow.filament_material || "").trim(),
            filament_color: String(valuesRow.filament_color || "").trim(),
            weight_grams: this.integer(valuesRow.weight_grams, "weight_grams"),
            print_time_minutes: this.integer(valuesRow.print_time_minutes, "print_time_minutes"),
            packaging_cost: this.money(valuesRow.packaging_cost, "packaging_cost"),
            extra_cost: this.money(valuesRow.extra_cost, "extra_cost"),
            is_active: true, updated_at: now,
          };
          if (existing) { Object.assign(existing, values); updated++; }
          else { unit.data.products.push({ id: crypto.randomUUID(), created_at: now, ...values }); created++; }
        } catch (error) {
          rowErrors.push(this.rowError(row, error));
        }
      });
      if (source === "google_api") {
        unit.data.products.forEach((product) => {
          const normalizedKey = `${product.marketplace}:${normalizeMarketplaceSku(product.marketplace_sku)}`;
          if (!seen.has(normalizedKey) && product.is_active) {
            product.is_active = false;
            product.updated_at = new Date().toISOString();
            updated++;
          }
        });
      }
      unit.touch("products");
    });
    await new ProblemOrderService(this.storage).retryAll();
    return {
      status: rowErrors.length ? "completed_with_problems" : "success",
      source, rowsRead: rows.length, imported: rows.length - rowErrors.length, created, updated,
      skipped: rowErrors.length, errors: rowErrors.length,
      sourceWeightGrams: 0, erpInitialWeightGrams: 0, erpRemainingWeightGrams: 0,
      weightDifferenceGrams: 0, activeSpools: 0, archivedSpools: 0, warnings: [], rowErrors,
    };
  }

  private async syncFilament(sourceData: GoogleReadSource): Promise<ImportStepReport> {
    const { rows, source } = sourceData;
    let created = 0;
    let updated = 0;
    const rowErrors: ImportStepReport["rowErrors"] = [];
    const warnings: string[] = [];
    const writeRows: string[][] = [];
    const importedIds = new Set<string>();
    let sourceWeightGrams = 0;
    await this.storage.transaction((unit) => {
      const seen = new Set<string>();
      rows.forEach((row) => {
        try {
          const valuesRow = this.filamentRow(row.values);
          const now = new Date().toISOString();
          let id = String(valuesRow.spool_id || "").trim();
          const fingerprint = this.filamentFingerprint(valuesRow);
          const linkedByRow = unit.data.filament_spools.find((spool) =>
            spool.google_spreadsheet_id === sourceData.spreadsheetId
            && spool.google_sheet_gid === sourceData.gid
            && spool.google_row_number === row.rowNumber);
          if (id && linkedByRow && linkedByRow.id !== id) {
            warnings.push(
              `Строка ${row.rowNumber}: spool_id изменён с ${linkedByRow.id} на ${id}`,
            );
            linkedByRow.google_spreadsheet_id = "";
            linkedByRow.google_sheet_gid = 0;
            linkedByRow.google_row_number = 0;
            linkedByRow.google_row_fingerprint = "";
          }
          if (!id && linkedByRow) {
            id = linkedByRow.id;
            if (linkedByRow.google_row_fingerprint
              && linkedByRow.google_row_fingerprint !== fingerprint) {
              warnings.push(
                `Строка ${row.rowNumber}: содержимое изменилось; сохранена привязка к катушке ${id}`,
              );
            }
          }
          id ||= crypto.randomUUID();
          seen.add(id);
          const existing = unit.data.filament_spools.find((spool) => spool.id === id);
          const initial = this.integer(valuesRow.spool_weight_grams, "spool_weight_grams");
          const hasExplicitRemaining = Boolean(String(valuesRow.remaining_weight_grams || "").trim());
          const remaining = hasExplicitRemaining
            ? this.integer(valuesRow.remaining_weight_grams, "remaining_weight_grams")
            : existing?.remaining_weight_grams ?? initial;
          const pricePerSpool = this.money(valuesRow.price_per_spool, "price_per_spool");
          const pricePerKg = valuesRow.price_per_kg
            ? this.money(valuesRow.price_per_kg, "price_per_kg")
            : initial > 0 ? Math.round(pricePerSpool / initial * 1000) : 0;
          if (initial <= 0 || remaining < 0 || remaining > initial) {
            throw new RowValidationError(
              "spool_weight_grams",
              valuesRow.spool_weight_grams,
              "Остаток должен быть от 0 до исходного веса катушки",
            );
          }
          sourceWeightGrams += initial;
          if (existing) {
            if (hasExplicitRemaining) {
              inventoryService.adjustRemaining(unit, id, remaining, "Корректировка из Google Sheets");
            }
            existing.material = String(valuesRow.material || "").trim();
            existing.color = String(valuesRow.color || "").trim();
            existing.brand = String(valuesRow.brand || "").trim();
            existing.supplier = String(valuesRow.supplier || valuesRow.brand || "").trim();
            existing.location = String(valuesRow.location || "").trim();
            existing.initial_weight_grams = initial;
            existing.price_per_spool = pricePerSpool;
            existing.price_per_kg = pricePerKg;
            existing.google_spreadsheet_id = sourceData.spreadsheetId;
            existing.google_sheet_gid = sourceData.gid;
            existing.google_row_number = row.rowNumber;
            existing.google_row_fingerprint = fingerprint;
            existing.purchase_date = this.iso(valuesRow.purchase_date) || existing.purchase_date;
            updated++;
          } else {
            if (!valuesRow.material) throw new RowValidationError("material", "", "Материал обязателен");
            if (!valuesRow.color) throw new RowValidationError("color", "", "Цвет обязателен");
            inventoryService.addSpool(unit, {
              id, material: valuesRow.material.trim(), color: valuesRow.color.trim(),
              brand: String(valuesRow.brand || "").trim(),
              supplier: String(valuesRow.supplier || valuesRow.brand || "").trim(),
              location: String(valuesRow.location || "").trim(),
              initial_weight_grams: initial, remaining_weight_grams: remaining, reserved_weight_grams: 0,
              price_per_spool: pricePerSpool, price_per_kg: pricePerKg,
              google_spreadsheet_id: sourceData.spreadsheetId,
              google_sheet_gid: sourceData.gid,
              google_row_number: row.rowNumber,
              google_row_fingerprint: fingerprint,
              purchase_date: this.iso(valuesRow.purchase_date) || now, status: remaining ? "active" : "empty",
              created_at: now, updated_at: now,
            });
            created++;
          }
          importedIds.add(id);
          const spool = unit.data.filament_spools.find((item) => item.id === id)!;
          writeRows.push([
            String(row.rowNumber), id, String(spool.remaining_weight_grams),
            String(spool.reserved_weight_grams), spool.status, spool.updated_at,
          ]);
        } catch (error) {
          rowErrors.push(this.rowError(row, error));
        }
      });
      if (source === "google_api") {
        unit.data.filament_spools.forEach((spool) => {
          if (!seen.has(spool.id) && spool.status !== "archived") {
            if (spool.reserved_weight_grams) {
              rowErrors.push({
                row: 0, field: "spool_id", value: spool.id,
                reason: "Катушку с резервом нельзя архивировать",
              });
              return;
            }
            spool.status = "archived";
            spool.updated_at = new Date().toISOString();
            updated++;
          }
        });
      }
      unit.touch("filament_spools");
    });
    if (sourceData.token && sourceData.title) {
      await this.writeFilamentState(
        sourceData.token, sourceData.spreadsheetId, sourceData.title, writeRows,
      );
    }
    await new ProblemOrderService(this.storage).retryAll();
    const database = await this.storage.read();
    const importedSpools = database.filament_spools.filter((spool) => importedIds.has(spool.id));
    const erpInitialWeightGrams = importedSpools.reduce(
      (sum, spool) => sum + spool.initial_weight_grams, 0,
    );
    const erpRemainingWeightGrams = importedSpools.reduce(
      (sum, spool) => sum + spool.remaining_weight_grams, 0,
    );
    return {
      status: rowErrors.length ? "completed_with_problems" : "success",
      source, rowsRead: rows.length, imported: importedIds.size, created, updated,
      skipped: rowErrors.length, errors: rowErrors.length,
      sourceWeightGrams, erpInitialWeightGrams, erpRemainingWeightGrams,
      weightDifferenceGrams: sourceWeightGrams - erpInitialWeightGrams,
      activeSpools: database.filament_spools.filter((spool) => spool.status !== "archived").length,
      archivedSpools: database.filament_spools.filter((spool) => spool.status === "archived").length,
      warnings, rowErrors,
    };
  }

  private async accessToken(values: Record<string, string>) {
    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: values.client_id, client_secret: values.client_secret,
        refresh_token: values.refresh_token, grant_type: "refresh_token",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.access_token) throw new Error("Не удалось обновить Google access token");
    return String(payload.access_token);
  }

  private async resolveSheet(token: string, target: GoogleSheetTarget) {
    const response = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${target.spreadsheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error("Google-таблица недоступна");
    const sheet = (payload.sheets || []).find((item: any) => Number(item.properties?.sheetId) === target.gid)
      || payload.sheets?.[0];
    if (!sheet?.properties?.title) throw new Error("В Google-таблице не найден лист");
    return { title: String(sheet.properties.title) };
  }

  private async readRows(token: string, spreadsheetId: string, title: string) {
    const range = encodeURIComponent(`'${title.replaceAll("'", "''")}'`);
    const response = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error("Не удалось прочитать Google-таблицу");
    const values = payload.values || [];
    return this.matrixToRows(values);
  }

  private async writeFilamentState(token: string, spreadsheetId: string, title: string, rows: string[][]) {
    if (!rows.length) return;
    const data = rows.flatMap(([row, id, remaining, reserved, status, updated]) => [
      { range: `'${title}'!A${row}`, values: [[id]] },
      { range: `'${title}'!F${row}:G${row}`, values: [[remaining, reserved]] },
      { range: `'${title}'!K${row}:L${row}`, values: [[status, updated]] },
    ]);
    const response = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
    if (!response.ok) throw new Error("Не удалось записать состояние катушек в Google Sheets");
  }

  private targetStatus(input: {
    url: string | undefined;
    operation: string;
    logs: Array<{
      source: string;
      operation: string;
      status: string;
      finished_at: string;
      summary: string;
      safe_message: string;
    }>;
    importedCount: number;
    oauthConnected: boolean;
  }): GoogleSheetStatus {
    const logs = input.logs.filter(
      (log) => log.source === "google_sheets"
        && log.operation === input.operation
        && log.finished_at,
    );
    const latest = [...logs].reverse().find((log) => log.summary);
    const latestSuccess = [...logs].reverse().find((log) => log.status === "success");
    const latestError = [...logs].reverse().find((log) => log.status === "error");
    let report: Partial<ImportStepReport> = {};
    try { report = latest?.summary ? JSON.parse(latest.summary) : {}; }
    catch { report = {}; }
    const configured = Boolean(input.url);
    const accessible = !configured || !latest
      ? null
      : latest.status === "success";
    return {
      configured,
      accessible,
      canSync: configured,
      url: input.url || "",
      lastSuccessfulSyncAt: latestSuccess?.finished_at || "",
      importedCount: input.importedCount,
      created: Number(report.created || 0),
      updated: Number(report.updated || 0),
      errors: Number(report.errors || 0),
      source: report.source || "none",
      rowsRead: Number(report.rowsRead || 0),
      imported: Number(report.imported || 0),
      skipped: Number(report.skipped || 0),
      sourceWeightGrams: Number(report.sourceWeightGrams || 0),
      erpInitialWeightGrams: Number(report.erpInitialWeightGrams || 0),
      erpRemainingWeightGrams: Number(report.erpRemainingWeightGrams || 0),
      weightDifferenceGrams: Number(report.weightDifferenceGrams || 0),
      activeSpools: Number(report.activeSpools || 0),
      archivedSpools: Number(report.archivedSpools || 0),
      warnings: Array.isArray(report.warnings) ? report.warnings.map(String) : [],
      lastError: latestError?.safe_message || "",
    };
  }

  private async readWithFallback(
    values: Record<string, string>,
    target: GoogleSheetTarget,
  ): Promise<GoogleReadSource> {
    if (values.refresh_token) {
      try {
        const token = await this.accessToken(values);
        const sheet = await this.resolveSheet(token, target);
        const rows = await this.readRows(token, target.spreadsheetId, sheet.title);
        return {
          source: "google_api", rows, token,
          spreadsheetId: target.spreadsheetId, gid: target.gid, title: sheet.title,
        };
      } catch {
        // Public endpoints remain a valid read-only fallback when OAuth is stale or lacks access.
      }
    }
    const urls = [
      `https://docs.google.com/spreadsheets/d/${target.spreadsheetId}/export?format=csv&gid=${target.gid}`,
      `https://docs.google.com/spreadsheets/d/${target.spreadsheetId}/gviz/tq?tqx=out:csv&gid=${target.gid}`,
    ];
    for (const url of urls) {
      try {
        const response = await this.fetcher(url, {
          headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.1" },
          redirect: "follow",
        });
        if (!response.ok) continue;
        const contentType = response.headers.get("content-type") || "";
        const body = await response.text();
        if (this.looksLikeHtml(contentType, body)) continue;
        const matrix = parse(body, {
          bom: true,
          relax_column_count: true,
          skip_empty_lines: true,
        }) as unknown[][];
        if (!matrix.length) continue;
        return {
          source: "public_csv",
          rows: this.matrixToRows(matrix),
          spreadsheetId: target.spreadsheetId,
          gid: target.gid,
        };
      } catch {
        // Try the next public endpoint.
      }
    }
    throw new Error(
      "Google-таблица закрыта для чтения. Подключите OAuth или включите доступ «Все, у кого есть ссылка» / опубликуйте лист.",
    );
  }

  private matrixToRows(values: unknown[][]): SheetRow[] {
    const headers = (values[0] || []).map((value) => String(value ?? "").trim());
    return values.slice(1)
      .map((row, index) => ({
        rowNumber: index + 2,
        values: Object.fromEntries(
          headers.map((header, column) => [header, String(row[column] ?? "")]),
        ),
      }))
      .filter((row) => Object.values(row.values).some((value) => value.trim()));
  }

  private looksLikeHtml(contentType: string, body: string) {
    const start = body.trimStart().slice(0, 200).toLowerCase();
    return contentType.toLowerCase().includes("text/html")
      || start.startsWith("<!doctype html")
      || start.startsWith("<html")
      || start.includes("<title>войти");
  }

  private productRow(row: Record<string, string>) {
    return this.aliasRow(row, {
      marketplace: ["marketplace", "площадка", "маркетплейс"],
      marketplace_sku: ["marketplace_sku", "артикул", "sku"],
      name: ["name", "название"],
      filament_material: ["filament_material", "тип пластика", "материал"],
      filament_color: ["filament_color", "цвет"],
      weight_grams: ["weight_grams", "вес (грам)", "вес (г)", "вес, г", "вес"],
      print_time_minutes: ["print_time_minutes", "время печати", "время печати (мин)"],
      packaging_cost: ["packaging_cost", "стоимость упаковки", "упаковка"],
      extra_cost: ["extra_cost", "дополнительные расходы", "прочие расходы"],
    });
  }

  private filamentRow(row: Record<string, string>) {
    const result = this.aliasRow(row, {
      spool_id: ["spool_id", "id катушки", "идентификатор катушки"],
      purchase_date: ["purchase_date", "дата", "дата покупки"],
      material: ["material", "материал"],
      color: ["color", "цвет"],
      spool_weight_grams: ["spool_weight_grams", "вес, г", "вес (г)", "вес (грам)", "вес"],
      remaining_weight_grams: ["remaining_weight_grams", "остаток, г", "остаток"],
      price_per_spool: ["price_per_spool", "цена", "цена катушки"],
      price_per_kg: ["price_per_kg", "цена за кг"],
      brand: ["brand", "бренд", "поставщик"],
      supplier: ["supplier", "поставщик"],
      location: ["location", "место", "место хранения"],
    });
    result.supplier ||= result.brand;
    return result;
  }

  private aliasRow(row: Record<string, string>, aliases: Record<string, string[]>) {
    const normalized = new Map(
      Object.entries(row).map(([key, value]) => [this.normalizeHeader(key), String(value ?? "").trim()]),
    );
    return Object.fromEntries(Object.entries(aliases).map(([field, names]) => [
      field,
      names.map((name) => normalized.get(this.normalizeHeader(name)) || "").find(Boolean) || "",
    ])) as Record<string, string>;
  }

  private normalizeHeader(value: string) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  private rowError(row: SheetRow, error: unknown): ImportStepReport["rowErrors"][number] {
    const values = this.filamentRow(row.values);
    const context = {
      material: values.material || "",
      color: values.color || "",
      weight: values.spool_weight_grams || values.remaining_weight_grams || "",
      price: values.price_per_spool || values.price_per_kg || "",
    };
    if (error instanceof RowValidationError) {
      return {
        row: row.rowNumber, field: error.field, value: error.value.slice(0, 100),
        reason: error.message, ...context,
      };
    }
    return {
      row: row.rowNumber, field: "", value: "",
      reason: error instanceof Error ? error.message : "Ошибка строки", ...context,
    };
  }
  private filamentFingerprint(values: Record<string, string>) {
    return createHash("sha256").update(JSON.stringify({
      material: values.material || "",
      color: values.color || "",
      purchase_date: values.purchase_date || "",
      spool_weight_grams: values.spool_weight_grams || "",
      price_per_spool: values.price_per_spool || "",
      brand: values.brand || "",
      supplier: values.supplier || "",
      location: values.location || "",
    })).digest("hex");
  }

  private numeric(value: string, field: string) {
    let normalized = String(value || "0")
      .trim()
      .replace(/(?:руб(?:\.|лей)?|₽|р\.)/gi, "")
      .replace(/\s|\u00a0|\u202f/g, "")
      .replace(/[^\d,.-]/g, "");
    if (normalized.includes(",")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if ((normalized.match(/\./g) || []).length > 1) {
      normalized = normalized.replace(/\./g, "");
    }
    const number = Number(normalized || "0");
    if (!Number.isFinite(number)) throw new RowValidationError(field, value, "Некорректное число");
    return number;
  }

  private integer(value: string, field: string) {
    const number = Math.round(this.numeric(value, field));
    if (number < 0) throw new RowValidationError(field, value, "Значение не может быть отрицательным");
    return number;
  }
  private money(value: string, field: string) {
    const number = this.numeric(value, field);
    if (number < 0) throw new RowValidationError(field, value, "Стоимость не может быть отрицательной");
    return Math.round(number * 100);
  }
  private iso(value: string) {
    if (!value) return "";
    const ru = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (ru) return new Date(Date.UTC(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]))).toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  private async log(operation: string, report: ImportStepReport, startedAt: string) {
    const summary = {
      status: report.status,
      source: report.source,
      rowsRead: report.rowsRead,
      imported: report.imported,
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      errors: report.errors,
      sourceWeightGrams: report.sourceWeightGrams,
      erpInitialWeightGrams: report.erpInitialWeightGrams,
      erpRemainingWeightGrams: report.erpRemainingWeightGrams,
      weightDifferenceGrams: report.weightDifferenceGrams,
      activeSpools: report.activeSpools,
      archivedSpools: report.archivedSpools,
      warnings: report.warnings,
    };
    await this.storage.transaction((unit) => {
      this.logs.appendToUnit(unit, {
        entryType: "step", source: "google_sheets", operation,
        status: report.status === "error" ? "error" : "success",
        safeMessage: report.errors ? `${report.errors} строк содержат ошибки` : "",
        startedAt,
        summary: JSON.stringify(summary),
      });
      report.rowErrors.forEach((error) => {
        this.logs.appendToUnit(unit, {
          entryType: "error",
          source: "google_sheets",
          operation,
          status: "error",
          errorCode: "VALIDATION_ERROR",
          safeMessage: `Строка ${error.row}, поле ${error.field || "не определено"}: ${error.reason}`,
          sku: error.field === "marketplace_sku" ? error.value : "",
          startedAt,
        });
      });
    });
  }
}
