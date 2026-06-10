import { ExcelStorageAdapter } from "@/lib/storage/excel-storage-adapter";
import { IntegrationSettingsService } from "@/lib/services/integration-settings-service";
import { SecretService } from "@/lib/services/secret-service";
import { StorageDiagnosticsService } from "@/lib/services/storage-diagnostics-service";
import { TunnelService } from "@/lib/services/tunnel-service";
import { WorkerService } from "@/lib/services/worker-service";
import { PrinterService } from "@/lib/services/printer-service";
import { FullSyncService } from "@/lib/services/full-sync-service";
import { ProblemOrderService } from "@/lib/services/problem-order-service";
import { GoogleSheetsService } from "@/lib/services/google-sheets-service";

const globalStorage = globalThis as typeof globalThis & { filamentStorage?: ExcelStorageAdapter };

export const storage = globalStorage.filamentStorage ?? new ExcelStorageAdapter();

if (process.env.NODE_ENV !== "production") globalStorage.filamentStorage = storage;

export const secretService = new SecretService(storage.getDataDir());
export const integrationSettingsService = new IntegrationSettingsService(storage, secretService);
export const googleSheetsService = new GoogleSheetsService(storage, integrationSettingsService);
export const tunnelService = new TunnelService(storage);
export const storageDiagnosticsService = new StorageDiagnosticsService(storage);
export const printerService = new PrinterService(storage, secretService);
export const problemOrderService = new ProblemOrderService(storage);
export const fullSyncService = new FullSyncService(storage, integrationSettingsService, undefined, googleSheetsService);

const globalServices = globalThis as typeof globalThis & { filamentWorker?: WorkerService };
export const workerService = globalServices.filamentWorker
  ?? new WorkerService(storage, integrationSettingsService, googleSheetsService);
globalServices.filamentWorker = workerService;
