import type { FinancialOperationType, IncomingOrder } from "@/lib/domain/types";

export interface SyncPeriod {
  from: string;
  to: string;
}

export interface NormalizedFinancialOperation {
  marketplace_order_id: string;
  operation_id: string;
  operation_date: string;
  type: FinancialOperationType;
  amount: number;
  description: string;
  raw_payload: unknown;
}

export interface MarketplaceAdapter {
  testConnection(): Promise<{ ok: true; name: string }>;
  syncOrders(period: SyncPeriod): Promise<IncomingOrder[]>;
  syncStatuses(period: SyncPeriod): Promise<IncomingOrder[]>;
  syncFinance(period: SyncPeriod): Promise<NormalizedFinancialOperation[]>;
}
