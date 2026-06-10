export type MarketplaceCode = "manual" | "yandex" | "ozon";
export type OrderStatus =
  | "new"
  | "waiting_production"
  | "in_production"
  | "printed"
  | "ready_to_ship"
  | "assembling"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "returned"
  | "problem";
export type PrintJobStatus = "queued" | "printing" | "success" | "failed" | "cancelled";
export type PrinterType = "manual" | "bambu_lab";
export type FilamentUsageSource = "planned" | "manual" | "printer" | "history";
export type CalculationState = "estimated" | "actual";
export type ProfitStatus = "complete" | "incomplete";
export type PaymentStatus = "not_available" | "expected" | "paid" | "refunded";
export type SyncProblemCode =
  | "SKU_NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "FILAMENT_NOT_FOUND"
  | "FILAMENT_NOT_ENOUGH"
  | "COST_NOT_CALCULATED";
export type SyncTechnicalErrorCode =
  | "YANDEX_API_ERROR"
  | "INVALID_ORDER_FORMAT"
  | "VALIDATION_ERROR"
  | "STORAGE_ERROR"
  | "UNKNOWN_ERROR";
export type MovementType =
  | "purchase"
  | "reserve"
  | "unreserve"
  | "write_off_print"
  | "write_off_failed"
  | "manual_adjustment"
  | "return_to_stock";
export type FinancialOperationType =
  | "sale"
  | "commission"
  | "logistics"
  | "boost"
  | "acquiring"
  | "storage"
  | "return"
  | "penalty"
  | "compensation"
  | "other";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: "admin";
  created_at: string;
  last_login: string;
}

export interface Product {
  id: string;
  marketplace: MarketplaceCode;
  marketplace_sku: string;
  name: string;
  filament_material: string;
  filament_color: string;
  weight_grams: number;
  print_time_minutes: number;
  packaging_cost: number;
  extra_cost: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FilamentSpool {
  id: string;
  material: string;
  color: string;
  brand: string;
  supplier: string;
  location: string;
  initial_weight_grams: number;
  remaining_weight_grams: number;
  reserved_weight_grams: number;
  price_per_spool: number;
  price_per_kg: number;
  google_spreadsheet_id: string;
  google_sheet_gid: number;
  google_row_number: number;
  google_row_fingerprint: string;
  purchase_date: string;
  status: "active" | "empty" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  marketplace: MarketplaceCode;
  marketplace_order_id: string;
  marketplace_status: string;
  marketplace_substatus: string;
  internal_status: OrderStatus;
  order_date: string;
  shipment_date: string;
  delivery_date: string;
  historical: boolean;
  gross_revenue: number;
  expected_payout: number;
  actual_payout: number;
  reported_payment_amount: number;
  reported_refund_amount: number;
  payment_status: PaymentStatus;
  payment_date: string;
  payout_date: string;
  payment_order_id: string;
  marketplace_cost: number;
  production_cost: number;
  profit: number;
  margin_percent: number;
  calculation_state: CalculationState;
  profit_status: ProfitStatus;
  problem_code: SyncProblemCode | "";
  problem_message: string;
  raw_payload: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  marketplace_sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  revenue: number;
  planned_filament_grams: number;
  reserved_filament_grams: number;
  actual_filament_grams: number;
  failed_filament_grams: number;
  spool_id: string;
  filament_cost: number;
  packaging_cost: number;
  electricity_cost: number;
  extra_cost: number;
  production_cost: number;
  allocated_marketplace_cost: number;
  profit: number;
  margin_percent: number;
  created_at: string;
  updated_at: string;
}

export interface FilamentMovement {
  id: string;
  spool_id: string;
  order_id: string;
  order_item_id: string;
  print_job_id: string;
  type: MovementType;
  grams: number;
  comment: string;
  created_at: string;
}

export interface PrintJob {
  id: string;
  order_id: string;
  order_item_id: string;
  printer_id: string;
  status: PrintJobStatus;
  planned_grams: number;
  actual_grams: number;
  failed_grams: number;
  usage_source: FilamentUsageSource;
  started_at: string;
  finished_at: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface Printer {
  id: string;
  name: string;
  type: PrinterType;
  host: string;
  access_code_encrypted: string;
  serial_number: string;
  is_active: boolean;
  last_status: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface FinancialOperation {
  id: string;
  marketplace: MarketplaceCode;
  order_id: string;
  marketplace_order_id: string;
  operation_id: string;
  operation_date: string;
  type: FinancialOperationType;
  amount: number;
  description: string;
  match_status: "matched" | "unmatched";
  raw_payload: string;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  run_id: string;
  entry_type: "run" | "step" | "problem" | "error";
  source: string;
  operation: string;
  status: "started" | "success" | "error";
  started_at: string;
  finished_at: string;
  summary: string;
  error_code: string;
  safe_message: string;
  order_id: string;
  sku: string;
  period_from: string;
  period_to: string;
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
  value_type: "number" | "boolean" | "string";
  updated_at: string;
}

export interface IntegrationSetting {
  id: string;
  provider: "yandex_market" | "ozon" | "google_sheets";
  key: string;
  value_encrypted: string;
  created_at: string;
  updated_at: string;
}

export interface MarketingExpense {
  id: string;
  date: string;
  amount: number;
  source: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  users: User[];
  products: Product[];
  filament_spools: FilamentSpool[];
  orders: Order[];
  order_items: OrderItem[];
  filament_movements: FilamentMovement[];
  print_jobs: PrintJob[];
  printers: Printer[];
  financial_operations: FinancialOperation[];
  sync_logs: SyncLog[];
  settings: SystemSetting[];
  integration_settings: IntegrationSetting[];
  marketing_expenses: MarketingExpense[];
}

export type TableName = keyof Database;
export type RowFor<T extends TableName> = Database[T][number];

export interface IncomingOrderItem {
  marketplace_sku: string;
  name?: string;
  quantity: number;
  unit_price: number;
}

export interface IncomingOrder {
  marketplace: MarketplaceCode;
  marketplace_order_id: string;
  marketplace_status?: string;
  marketplace_substatus?: string;
  order_date: string;
  shipment_date?: string;
  delivery_date?: string;
  reported_payment_amount?: number;
  reported_refund_amount?: number;
  confirmed_payout_amount?: number;
  payment_status?: PaymentStatus;
  payment_date?: string;
  payout_date?: string;
  payment_order_id?: string;
  historical?: boolean;
  items: IncomingOrderItem[];
  raw_payload?: unknown;
}
