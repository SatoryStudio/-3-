import type { Database, TableName } from "@/lib/domain/types";

export const SCHEMA_VERSION = 8;
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

export const TABLE_COLUMNS: { [K in TableName]: readonly (keyof Database[K][number])[] } = {
  users: ["id", "email", "password_hash", "role", "created_at", "last_login"],
  products: [
    "id", "marketplace", "marketplace_sku", "name", "filament_material", "filament_color",
    "weight_grams", "print_time_minutes", "packaging_cost", "extra_cost", "is_active", "created_at", "updated_at",
  ],
  filament_spools: [
    "id", "material", "color", "brand", "supplier", "location", "initial_weight_grams", "remaining_weight_grams",
    "reserved_weight_grams", "price_per_spool", "price_per_kg", "google_spreadsheet_id", "google_sheet_gid",
    "google_row_number", "google_row_fingerprint", "purchase_date", "status", "created_at", "updated_at",
  ],
  orders: [
    "id", "marketplace", "marketplace_order_id", "marketplace_status", "marketplace_substatus",
    "internal_status", "order_date", "shipment_date", "delivery_date", "historical",
    "gross_revenue", "expected_payout", "actual_payout", "reported_payment_amount", "reported_refund_amount",
    "payment_status", "payment_date", "payout_date", "payment_order_id", "marketplace_cost",
    "production_cost", "profit", "margin_percent", "calculation_state", "profit_status", "problem_code", "problem_message",
    "raw_payload", "created_at", "updated_at",
  ],
  order_items: [
    "id", "order_id", "product_id", "marketplace_sku", "name", "quantity", "unit_price", "revenue",
    "planned_filament_grams", "reserved_filament_grams", "actual_filament_grams", "failed_filament_grams",
    "spool_id", "filament_cost", "packaging_cost", "electricity_cost", "extra_cost", "production_cost",
    "allocated_marketplace_cost", "profit", "margin_percent", "created_at", "updated_at",
  ],
  filament_movements: [
    "id", "spool_id", "order_id", "order_item_id", "print_job_id", "type", "grams", "comment", "created_at",
  ],
  print_jobs: [
    "id", "order_id", "order_item_id", "printer_id", "status", "planned_grams", "actual_grams", "failed_grams",
    "usage_source", "started_at", "finished_at", "comment", "created_at", "updated_at",
  ],
  printers: [
    "id", "name", "type", "host", "access_code_encrypted", "serial_number", "is_active",
    "last_status", "last_seen_at", "created_at", "updated_at",
  ],
  financial_operations: [
    "id", "marketplace", "order_id", "marketplace_order_id", "operation_id", "operation_date", "type",
    "amount", "description", "match_status", "raw_payload", "created_at", "updated_at",
  ],
  sync_logs: [
    "id", "run_id", "entry_type", "source", "operation", "status", "started_at", "finished_at",
    "summary", "error_code", "safe_message", "order_id", "sku", "period_from", "period_to", "created_at",
  ],
  settings: ["key", "value", "value_type", "updated_at"],
  integration_settings: ["id", "provider", "key", "value_encrypted", "created_at", "updated_at"],
  marketing_expenses: ["id", "date", "amount", "source", "comment", "created_at", "updated_at"],
};

export const DEFAULT_SETTINGS: Database["settings"] = [
  { key: "defaultPackagingCost", value: "3500", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "defaultElectricityCost", value: "0", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "warningFilamentLevel", value: "300", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "criticalFilamentLevel", value: "100", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "tunnelProvider", value: "none", value_type: "string", updated_at: new Date(0).toISOString() },
  { key: "tunnelPublicUrl", value: "", value_type: "string", updated_at: new Date(0).toISOString() },
  { key: "workerEnabled", value: "false", value_type: "boolean", updated_at: new Date(0).toISOString() },
  { key: "workerOrdersIntervalMinutes", value: "5", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "workerStatusesIntervalMinutes", value: "60", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "workerFinanceIntervalMinutes", value: "1440", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "workerGoogleProductsIntervalMinutes", value: "15", value_type: "number", updated_at: new Date(0).toISOString() },
  { key: "workerGoogleFilamentIntervalMinutes", value: "15", value_type: "number", updated_at: new Date(0).toISOString() },
];

export const TABLE_NAMES = Object.keys(TABLE_COLUMNS) as TableName[];
