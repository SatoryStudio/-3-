import type { Database, TableName } from "@/lib/domain/types";

export interface UnitOfWork {
  data: Database;
  touch(...tables: TableName[]): void;
}

export interface StorageAdapter {
  initialize(): Promise<void>;
  read(): Promise<Database>;
  transaction<T>(operation: (unit: UnitOfWork) => Promise<T> | T): Promise<T>;
}
