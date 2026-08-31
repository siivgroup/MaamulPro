// ──────────────────────────────────────────────────────────────
// Tenant Schema DDL
//
// Programmatic equivalent of `prisma db push` for the tenant schema.
// Executed via pg.Pool.query() — no Prisma CLI binary required.
// All statements are idempotent: safe to re-run on an existing schema.
//
// IMPORTANT: Keep in sync with prisma/tenant/schema.prisma.
// ──────────────────────────────────────────────────────────────

import { Pool, PoolClient } from "pg";
import { assertEmptyOrOwned } from './onboarding-database';
import { setupDiagnostic } from './onboarding-errors';
import { connectionTimeoutMillis, getDatabaseConnectionPair } from "./database-url";

export const CURRENT_TENANT_SCHEMA_VERSION = 30;

export const TENANT_SCHEMA_STATEMENTS: string[] = [
  // ── Enum types ─────────────────────────────────────────────
  `DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN','ADMIN','MANAGER','STAFF');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "Department" AS ENUM ('GENERAL','CONSTRUCTION','REAL_ESTATE');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE','INACTIVE','ON_LEAVE','TERMINATED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "TransactionType" AS ENUM ('INCOME','EXPENSE');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "TransactionStatus" AS ENUM ('CLEARED','PROCESSING','PENDING','CANCELLED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING','ONGOING','ON_HOLD','COMPLETED','CANCELLED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "TaskStatus" AS ENUM ('NOT_STARTED','IN_PROGRESS','COMPLETED','BLOCKED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "TaskPriority" AS ENUM ('LOW','MEDIUM','HIGH','URGENT');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "PropertyType" AS ENUM ('HOUSE','APARTMENT','LAND','COMMERCIAL');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "PropertyStatus" AS ENUM ('AVAILABLE','SOLD','RENTED','UNDER_CONTRACT');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "DealType" AS ENUM ('SALE','RENTAL');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "DealPaymentStatus" AS ENUM ('PAID','PARTIAL','PENDING','OVERDUE','REFUNDED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "UnitType" AS ENUM ('KG','BAG','PIECE','METER','LITER','TON','TRUCK_LOAD','LOT','SQUARE_METER','SET','BUCKET');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "InventoryTransactionType" AS ENUM ('RESTOCK','USAGE');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'COMPANY_OWNER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'GENERAL_MANAGER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CONSTRUCTION_MANAGER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SITE_ENGINEER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROJECT_SUPERVISOR'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROCUREMENT_OFFICER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STOREKEEPER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANPOWER_SUPERVISOR'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'REAL_ESTATE_MANAGER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SALES_AGENT'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RENTAL_OFFICER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROPERTY_SUPERVISOR'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MATERIAL_MANAGER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SALES_STAFF'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INVENTORY_OFFICER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPLIER_OFFICER'`,
  `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DELIVERY_OFFICER'`,
  `ALTER TYPE "Department" ADD VALUE IF NOT EXISTS 'MATERIAL_MANAGEMENT'`,
  `ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'TRUCK_LOAD'`,
  `ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'LOT'`,
  `ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'SQUARE_METER'`,
  `ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'SET'`,
  `ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'BUCKET'`,
  `ALTER TYPE "InventoryTransactionType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT'`,
  `ALTER TYPE "InventoryTransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER'`,

  `DO $$ BEGIN
    CREATE TYPE "RentalPaymentStatus" AS ENUM ('PAID','UNPAID','LATE','PARTIAL');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE','EXPIRED','RENEWAL_DUE','TERMINATED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "MaterialProductStatus" AS ENUM ('ACTIVE','INACTIVE','DISCONTINUED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT','ORDERED','RECEIVED','CANCELLED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING','IN_TRANSIT','DELIVERED','CANCELLED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "ReportScheduleFrequency" AS ENUM ('WEEKLY','MONTHLY','YEARLY');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','PAID');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ── Tables ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "system_config" (
    "id"         TEXT        NOT NULL PRIMARY KEY,
    "key"        TEXT        NOT NULL UNIQUE,
    "value"      TEXT        NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "report_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "report_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "ReportScheduleFrequency" NOT NULL,
    "recipients" TEXT,
    "filters" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_delivery_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "users" (
    "id"                     TEXT         NOT NULL PRIMARY KEY,
    "email"                  TEXT         NOT NULL UNIQUE,
    "password_hash"          TEXT         NOT NULL,
    "name"                   TEXT         NOT NULL,
    "role"                   "UserRole"   NOT NULL DEFAULT 'STAFF',
    "avatar_url"             TEXT,
    "is_active"              BOOLEAN      NOT NULL DEFAULT true,
    "construction_access"    BOOLEAN      NOT NULL DEFAULT true,
    "real_estate_access"     BOOLEAN      NOT NULL DEFAULT true,
    "material_management_access" BOOLEAN   NOT NULL DEFAULT true,
    "last_login_at"          TIMESTAMP(3),
    "reset_token_hash"       TEXT,
    "reset_token_expires_at" TIMESTAMP(3),
    "reset_requested_at"     TIMESTAMP(3),
    "password_reset_at"      TIMESTAMP(3),
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"             TIMESTAMP(3)
  )`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "identity_version" INTEGER NOT NULL DEFAULT 0`,

  `CREATE TABLE IF NOT EXISTS "staff" (
    "id"         TEXT          NOT NULL PRIMARY KEY,
    "user_id"    TEXT          UNIQUE,
    "first_name" TEXT          NOT NULL,
    "last_name"  TEXT          NOT NULL,
    "phone"      TEXT,
    "department" "Department"  NOT NULL DEFAULT 'GENERAL',
    "position"   TEXT,
    "salary"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hire_date"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"     "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes"      TEXT,
    "photo_url"  TEXT,
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "categories" (
    "id"          TEXT         NOT NULL PRIMARY KEY,
    "name"        TEXT         NOT NULL UNIQUE,
    "code"        TEXT         UNIQUE,
    "description" TEXT,
    "color"       TEXT         DEFAULT '#6366f1',
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "projects" (
    "id"          TEXT            NOT NULL PRIMARY KEY,
    "name"        TEXT            NOT NULL,
    "location"    TEXT,
    "description" TEXT,
    "status"      "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "budget"      DECIMAL(12,2)   NOT NULL DEFAULT 0,
    "start_date"  TIMESTAMP(3),
    "end_date"    TIMESTAMP(3),
    "progress"    INTEGER         NOT NULL DEFAULT 0,
    "image_url"   TEXT,
    "created_at"  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "properties" (
    "id"          TEXT              NOT NULL PRIMARY KEY,
    "title"       TEXT              NOT NULL,
    "type"        "PropertyType"    NOT NULL,
    "status"      "PropertyStatus"  NOT NULL DEFAULT 'AVAILABLE',
    "address"     TEXT,
    "description" TEXT,
    "price"       DECIMAL(12,2)     NOT NULL DEFAULT 0,
    "area"        DECIMAL(10,2),
    "bedrooms"    INTEGER,
    "bathrooms"   INTEGER,
    "image_url"   TEXT,
    "created_at"  TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "clients" (
    "id"         TEXT         NOT NULL PRIMARY KEY,
    "name"       TEXT         NOT NULL,
    "email"      TEXT,
    "phone"      TEXT,
    "notes"      TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "transactions" (
    "id"           TEXT                NOT NULL PRIMARY KEY,
    "reference_id" TEXT                NOT NULL UNIQUE,
    "type"         "TransactionType"   NOT NULL,
    "status"       "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "description"  TEXT                NOT NULL,
    "amount"       DECIMAL(12,2)       NOT NULL,
    "date"         TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category_id"  TEXT,
    "user_id"      TEXT,
    "project_id"   TEXT,
    "property_id"  TEXT,
    "deal_id"      TEXT,
    "material_id"  TEXT,
    "notes"        TEXT,
    "created_at"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"   TIMESTAMP(3)
  )`,
  `ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "request_hash" TEXT`,

  `CREATE TABLE IF NOT EXISTS "activity_logs" (
    "id"         TEXT         NOT NULL PRIMARY KEY,
    "user_id"    TEXT         NOT NULL,
    "action"     TEXT         NOT NULL,
    "entity"     TEXT         NOT NULL,
    "entity_id"  TEXT,
    "resource"   TEXT,
    "details"    TEXT,
    "ip_address" TEXT,
    "device_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "operational_alerts" (
    "id"                  TEXT         NOT NULL PRIMARY KEY,
    "source_key"          TEXT         NOT NULL,
    "type"                TEXT         NOT NULL,
    "severity"            TEXT         NOT NULL,
    "title"               TEXT         NOT NULL,
    "details"             TEXT,
    "target_path"         TEXT,
    "required_permission" TEXT         NOT NULL,
    "assignee_id"         TEXT,
    "active_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at"         TIMESTAMP(3),
    "escalated_at"        TIMESTAMP(3),
    "last_emailed_at"     TIMESTAMP(3),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "operational_alert_reads" (
    "id"       TEXT         NOT NULL PRIMARY KEY,
    "alert_id" TEXT         NOT NULL REFERENCES "operational_alerts"("id") ON DELETE CASCADE,
    "user_id"  TEXT         NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "read_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "project_tasks" (
    "id"          TEXT           NOT NULL PRIMARY KEY,
    "project_id"  TEXT           NOT NULL,
    "title"       TEXT           NOT NULL,
    "description" TEXT,
    "status"      "TaskStatus"   NOT NULL DEFAULT 'NOT_STARTED',
    "priority"    "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "progress"    INTEGER        NOT NULL DEFAULT 0,
    "due_date"    TIMESTAMP(3),
    "assignee_id" TEXT,
    "staff_id"    TEXT,
    "created_at"  TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "deals" (
    "id"             TEXT                NOT NULL PRIMARY KEY,
    "property_id"    TEXT                NOT NULL,
    "client_id"      TEXT                NOT NULL,
    "created_by_id"  TEXT,
    "type"           "DealType"          NOT NULL,
    "payment_status" "DealPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "total_amount"   DECIMAL(12,2)       NOT NULL DEFAULT 0,
    "paid_amount"    DECIMAL(12,2)       NOT NULL DEFAULT 0,
    "notes"          TEXT,
    "closed_at"      TIMESTAMP(3),
    "created_at"     TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"     TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "materials" (
    "id"         TEXT         NOT NULL PRIMARY KEY,
    "name"       TEXT         NOT NULL,
    "category"   TEXT,
    "material_type" TEXT,
    "photo_url"  TEXT,
    "quantity"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit"       "UnitType"    NOT NULL,
    "unit_cost"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sale_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warehouse"  TEXT,
    "low_stock_threshold" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status"     "MaterialProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "inventory_transactions" (
    "id"          TEXT                       NOT NULL PRIMARY KEY,
    "material_id" TEXT                       NOT NULL,
    "project_id"  TEXT,
    "type"        "InventoryTransactionType" NOT NULL,
    "quantity"    DECIMAL(12,2)              NOT NULL,
    "date"        TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id"     TEXT                       NOT NULL,
    "notes"       TEXT,
    "warehouse"   TEXT,
    "created_at"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "national_id_passport" TEXT,
    "property_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "rental_contracts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "monthly_rent" DECIMAL(12,2) NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "renewal_date" TIMESTAMP(3),
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "rent_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_date" TIMESTAMP(3),
    "amount_due" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "RentalPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "receipt_no" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "supplier_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplier_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplier_id" TEXT,
    "order_no" TEXT NOT NULL UNIQUE,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "total_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "purchase_order_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchase_order_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "material_customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "material_sales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customer_id" TEXT,
    "user_id" TEXT,
    "invoice_no" TEXT NOT NULL UNIQUE,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(5,2),
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "material_sale_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sale_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "transportation_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "delivery_no" TEXT NOT NULL UNIQUE,
    "responsible_person" TEXT NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "delivery_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "transportation_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transportation_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "worker_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "description" TEXT,
    "color" TEXT DEFAULT '#6366f1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "manpower_workers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "linked_staff_id" TEXT UNIQUE,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "worker_type_id" TEXT,
    "assigned_project_id" TEXT,
    "notes" TEXT,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "daily_operational_expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staff_id" TEXT,
    "worker_id" TEXT,
    "project_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  // ── RBAC tables ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "rbac_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL UNIQUE,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "workspace" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "rbac_roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "rbac_role_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "rbac_user_roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "rbac_user_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'ALLOW',
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "worker_ledger_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "staff_id" TEXT,
    "worker_id" TEXT,
    "project_id" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // ── Column Additions (idempotent) ────────────────────────────
  `DO $$ BEGIN
    ALTER TABLE "daily_operational_expenses" ADD COLUMN "worker_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "worker_ledger_entries" ADD COLUMN "worker_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "users" ADD COLUMN "construction_access" BOOLEAN NOT NULL DEFAULT true;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "users" ADD COLUMN "real_estate_access" BOOLEAN NOT NULL DEFAULT true;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "users" ADD COLUMN "material_management_access" BOOLEAN NOT NULL DEFAULT true;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "users" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "activity_logs" ADD COLUMN "resource" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "activity_logs" ADD COLUMN "device_info" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "materials" ADD COLUMN "category" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "materials" ADD COLUMN "material_type" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "materials" ADD COLUMN "sale_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "materials" ADD COLUMN "warehouse" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "materials" ADD COLUMN "low_stock_threshold" DECIMAL(12,2) NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "materials" ADD COLUMN "status" "MaterialProductStatus" NOT NULL DEFAULT 'ACTIVE';
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "inventory_transactions" ADD COLUMN "warehouse" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "deals" ADD COLUMN "payment_status" "DealPaymentStatus" NOT NULL DEFAULT 'PENDING';
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "staff" ADD COLUMN "worker_type_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "staff" ADD COLUMN "assigned_project_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "staff" ADD COLUMN "photo_url" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "material_sales" ADD COLUMN "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "material_sales" ADD COLUMN "discount_percent" DECIMAL(5,2);
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  // ── Foreign keys (idempotent) ────────────────────────────────
  `DO $$ BEGIN
    ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_property_id_fkey"
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deal_id_fkey"
      FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignee_id_fkey"
      FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_property_id_fkey"
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_property_id_fkey"
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_property_id_fkey"
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "rental_contracts"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "supplier_transactions" ADD CONSTRAINT "supplier_transactions_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "material_sales" ADD CONSTRAINT "material_sales_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "material_customers"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "material_sales" ADD CONSTRAINT "material_sales_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "material_sale_items" ADD CONSTRAINT "material_sale_items_sale_id_fkey"
      FOREIGN KEY ("sale_id") REFERENCES "material_sales"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "material_sale_items" ADD CONSTRAINT "material_sale_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transportation_items" ADD CONSTRAINT "transportation_items_transportation_id_fkey"
      FOREIGN KEY ("transportation_id") REFERENCES "transportation_records"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transportation_items" ADD CONSTRAINT "transportation_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "worker_ledger_entries" ADD CONSTRAINT "worker_ledger_entries_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "worker_ledger_entries" ADD CONSTRAINT "worker_ledger_entries_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "worker_ledger_entries" ADD CONSTRAINT "worker_ledger_entries_worker_id_fkey"
      FOREIGN KEY ("worker_id") REFERENCES "manpower_workers"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "worker_ledger_entries" ADD CONSTRAINT "worker_ledger_entries_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "staff" ADD CONSTRAINT "staff_worker_type_id_fkey"
      FOREIGN KEY ("worker_type_id") REFERENCES "worker_types"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "staff" ADD CONSTRAINT "staff_assigned_project_id_fkey"
      FOREIGN KEY ("assigned_project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "manpower_workers" ADD CONSTRAINT "manpower_workers_linked_staff_id_fkey"
      FOREIGN KEY ("linked_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "manpower_workers" ADD CONSTRAINT "manpower_workers_worker_type_id_fkey"
      FOREIGN KEY ("worker_type_id") REFERENCES "worker_types"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "manpower_workers" ADD CONSTRAINT "manpower_workers_assigned_project_id_fkey"
      FOREIGN KEY ("assigned_project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "daily_operational_expenses" ADD CONSTRAINT "daily_operational_expenses_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "daily_operational_expenses" ADD CONSTRAINT "daily_operational_expenses_worker_id_fkey"
      FOREIGN KEY ("worker_id") REFERENCES "manpower_workers"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "daily_operational_expenses" ADD CONSTRAINT "daily_operational_expenses_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ── RBAC foreign keys ─────────────────────────────────────────
  `DO $$ BEGIN
    ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_permission_id_fkey"
      FOREIGN KEY ("permission_id") REFERENCES "rbac_permissions"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rbac_user_permissions" ADD CONSTRAINT "rbac_user_permissions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "rbac_user_permissions" ADD CONSTRAINT "rbac_user_permissions_permission_id_fkey"
      FOREIGN KEY ("permission_id") REFERENCES "rbac_permissions"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ── Indexes (idempotent) ─────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS "users_email_idx"              ON "users"("email")`,
  `CREATE INDEX IF NOT EXISTS "report_schedules_report_id_idx" ON "report_schedules"("report_id")`,
  `CREATE INDEX IF NOT EXISTS "report_schedules_is_active_idx" ON "report_schedules"("is_active")`,
  `ALTER TABLE "report_schedules" ADD COLUMN IF NOT EXISTS "last_run_at" TIMESTAMP(3)`,
  `ALTER TABLE "report_schedules" ADD COLUMN IF NOT EXISTS "last_success_at" TIMESTAMP(3)`,
  `ALTER TABLE "report_schedules" ADD COLUMN IF NOT EXISTS "last_failure_at" TIMESTAMP(3)`,
  `ALTER TABLE "report_schedules" ADD COLUMN IF NOT EXISTS "last_error" TEXT`,
  `ALTER TABLE "report_schedules" ADD COLUMN IF NOT EXISTS "last_delivery_id" TEXT`,
  `CREATE INDEX IF NOT EXISTS "staff_department_idx"         ON "staff"("department")`,
  `CREATE INDEX IF NOT EXISTS "staff_status_idx"             ON "staff"("status")`,
  `CREATE INDEX IF NOT EXISTS "transactions_type_idx"        ON "transactions"("type")`,
  `CREATE INDEX IF NOT EXISTS "transactions_date_idx"        ON "transactions"("date")`,
  `CREATE INDEX IF NOT EXISTS "transactions_category_id_idx" ON "transactions"("category_id")`,
  `CREATE INDEX IF NOT EXISTS "transactions_project_id_idx"  ON "transactions"("project_id")`,
  `CREATE INDEX IF NOT EXISTS "transactions_property_id_idx" ON "transactions"("property_id")`,
  `CREATE INDEX IF NOT EXISTS "activity_logs_user_id_idx"    ON "activity_logs"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "activity_logs_entity_idx"     ON "activity_logs"("entity")`,
  `CREATE INDEX IF NOT EXISTS "activity_logs_created_at_idx" ON "activity_logs"("created_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "operational_alerts_source_key_active_key" ON "operational_alerts"("source_key") WHERE "resolved_at" IS NULL`,
  `CREATE INDEX IF NOT EXISTS "operational_alerts_permission_active_idx" ON "operational_alerts"("required_permission", "resolved_at")`,
  `CREATE INDEX IF NOT EXISTS "operational_alerts_active_at_idx" ON "operational_alerts"("active_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "operational_alert_reads_alert_id_user_id_key" ON "operational_alert_reads"("alert_id", "user_id")`,
  `CREATE INDEX IF NOT EXISTS "operational_alert_reads_user_id_read_at_idx" ON "operational_alert_reads"("user_id", "read_at")`,

  `ALTER TABLE "operational_alerts" ADD COLUMN IF NOT EXISTS "assignee_id" TEXT`,
  `ALTER TABLE "operational_alerts" ADD COLUMN IF NOT EXISTS "escalated_at" TIMESTAMP(3)`,
  `ALTER TABLE "operational_alerts" ADD COLUMN IF NOT EXISTS "last_emailed_at" TIMESTAMP(3)`,
  `ALTER TABLE "operational_alert_reads" ADD COLUMN IF NOT EXISTS "dismissed_at" TIMESTAMP(3)`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approval_limit" DECIMAL(12,2)`,
  `CREATE TABLE IF NOT EXISTS "accounting_periods" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "locked_at" TIMESTAMP(3),
    "locked_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "accounting_periods_start_date_end_date_status_idx" ON "accounting_periods"("start_date", "end_date", "status")`,
  `WITH current_period AS (
    SELECT date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS start_date
  )
  INSERT INTO "accounting_periods" ("id", "name", "start_date", "end_date", "status", "created_at", "updated_at")
  SELECT
    'system-accounting-period-' || to_char(cp.start_date, 'YYYY-MM'),
    to_char(cp.start_date, 'FMMonth YYYY'),
    cp.start_date,
    cp.start_date + INTERVAL '1 month' - INTERVAL '1 millisecond',
    'OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM current_period cp
  WHERE NOT EXISTS (
    SELECT 1 FROM "accounting_periods" p
    WHERE p."start_date" <= cp.start_date + INTERVAL '1 month' - INTERVAL '1 millisecond'
      AND p."end_date" >= cp.start_date
  )
  ON CONFLICT ("id") DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS "document_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
    "signed_at" TIMESTAMP(3),
    "signed_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "document_attachments_entity_type_entity_id_idx" ON "document_attachments"("entity_type", "entity_id")`,
  `CREATE INDEX IF NOT EXISTS "operational_alerts_assignee_id_resolved_at_idx" ON "operational_alerts"("assignee_id", "resolved_at")`,
  `DO $$ BEGIN
    ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_assignee_id_fkey"
      FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `CREATE INDEX IF NOT EXISTS "projects_status_idx"          ON "projects"("status")`,
  `CREATE INDEX IF NOT EXISTS "project_tasks_project_id_idx" ON "project_tasks"("project_id")`,
  `CREATE INDEX IF NOT EXISTS "project_tasks_status_idx"     ON "project_tasks"("status")`,
  `CREATE INDEX IF NOT EXISTS "properties_type_idx"          ON "properties"("type")`,
  `CREATE INDEX IF NOT EXISTS "properties_status_idx"        ON "properties"("status")`,
  `CREATE INDEX IF NOT EXISTS "deals_property_id_idx"        ON "deals"("property_id")`,
  `CREATE INDEX IF NOT EXISTS "deals_client_id_idx"          ON "deals"("client_id")`,
  `CREATE INDEX IF NOT EXISTS "deals_payment_status_idx"     ON "deals"("payment_status")`,
  `CREATE INDEX IF NOT EXISTS "inventory_transactions_material_id_idx" ON "inventory_transactions"("material_id")`,
  `CREATE INDEX IF NOT EXISTS "inventory_transactions_project_id_idx"  ON "inventory_transactions"("project_id")`,
  `CREATE INDEX IF NOT EXISTS "inventory_transactions_date_idx"        ON "inventory_transactions"("date")`,
  `CREATE INDEX IF NOT EXISTS "tenants_property_id_idx" ON "tenants"("property_id")`,
  `CREATE INDEX IF NOT EXISTS "rental_contracts_tenant_id_idx" ON "rental_contracts"("tenant_id")`,
  `CREATE INDEX IF NOT EXISTS "rental_contracts_property_id_idx" ON "rental_contracts"("property_id")`,
  `CREATE INDEX IF NOT EXISTS "rental_contracts_status_idx" ON "rental_contracts"("status")`,
  `CREATE INDEX IF NOT EXISTS "rent_payments_tenant_id_idx" ON "rent_payments"("tenant_id")`,
  `CREATE INDEX IF NOT EXISTS "rent_payments_due_date_idx" ON "rent_payments"("due_date")`,
  `CREATE INDEX IF NOT EXISTS "rent_payments_status_idx" ON "rent_payments"("status")`,
  `CREATE INDEX IF NOT EXISTS "supplier_transactions_supplier_id_idx" ON "supplier_transactions"("supplier_id")`,
  `CREATE INDEX IF NOT EXISTS "supplier_transactions_date_idx" ON "supplier_transactions"("date")`,
  `CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id")`,
  `CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx" ON "purchase_orders"("status")`,
  `CREATE INDEX IF NOT EXISTS "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id")`,
  `CREATE INDEX IF NOT EXISTS "purchase_order_items_material_id_idx" ON "purchase_order_items"("material_id")`,
  `CREATE INDEX IF NOT EXISTS "material_sales_customer_id_idx" ON "material_sales"("customer_id")`,
  `CREATE INDEX IF NOT EXISTS "material_sales_date_idx" ON "material_sales"("date")`,
  `CREATE INDEX IF NOT EXISTS "material_sale_items_sale_id_idx" ON "material_sale_items"("sale_id")`,
  `CREATE INDEX IF NOT EXISTS "material_sale_items_material_id_idx" ON "material_sale_items"("material_id")`,
  `CREATE INDEX IF NOT EXISTS "transportation_records_status_idx" ON "transportation_records"("status")`,
  `CREATE INDEX IF NOT EXISTS "transportation_items_transportation_id_idx" ON "transportation_items"("transportation_id")`,
  `CREATE INDEX IF NOT EXISTS "transportation_items_material_id_idx" ON "transportation_items"("material_id")`,
  `CREATE INDEX IF NOT EXISTS "worker_ledger_entries_staff_id_idx" ON "worker_ledger_entries"("staff_id")`,
  `CREATE INDEX IF NOT EXISTS "worker_ledger_entries_project_id_idx" ON "worker_ledger_entries"("project_id")`,
  `CREATE INDEX IF NOT EXISTS "worker_ledger_entries_date_idx" ON "worker_ledger_entries"("date")`,
  `CREATE INDEX IF NOT EXISTS "staff_worker_type_id_idx" ON "staff"("worker_type_id")`,
  `CREATE INDEX IF NOT EXISTS "staff_assigned_project_id_idx" ON "staff"("assigned_project_id")`,
  `CREATE INDEX IF NOT EXISTS "daily_operational_expenses_staff_id_idx" ON "daily_operational_expenses"("staff_id")`,
  `CREATE INDEX IF NOT EXISTS "daily_operational_expenses_project_id_idx" ON "daily_operational_expenses"("project_id")`,
  `CREATE INDEX IF NOT EXISTS "daily_operational_expenses_date_idx" ON "daily_operational_expenses"("date")`,
  `CREATE INDEX IF NOT EXISTS "daily_operational_expenses_category_idx" ON "daily_operational_expenses"("category")`,
  // Composite indexes are aligned with the dashboard and report filters.
  `CREATE INDEX IF NOT EXISTS "transactions_deleted_at_status_date_idx" ON "transactions"("deleted_at", "status", "date")`,
  `CREATE INDEX IF NOT EXISTS "transactions_deleted_at_project_id_date_idx" ON "transactions"("deleted_at", "project_id", "date")`,
  `CREATE INDEX IF NOT EXISTS "projects_deleted_at_status_idx" ON "projects"("deleted_at", "status")`,
  `CREATE INDEX IF NOT EXISTS "inventory_transactions_type_project_id_date_idx" ON "inventory_transactions"("type", "project_id", "date")`,
  `CREATE INDEX IF NOT EXISTS "rent_payments_deleted_at_due_date_idx" ON "rent_payments"("deleted_at", "due_date")`,
  `CREATE INDEX IF NOT EXISTS "material_sales_deleted_at_date_idx" ON "material_sales"("deleted_at", "date")`,
  `CREATE INDEX IF NOT EXISTS "daily_operational_expenses_deleted_at_project_id_date_idx" ON "daily_operational_expenses"("deleted_at", "project_id", "date")`,
  `CREATE INDEX IF NOT EXISTS "deals_deleted_at_payment_status_idx" ON "deals"("deleted_at", "payment_status")`,

  // ── RBAC indexes ───────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS "rbac_permissions_module_idx" ON "rbac_permissions"("module")`,
  `CREATE INDEX IF NOT EXISTS "rbac_permissions_workspace_idx" ON "rbac_permissions"("workspace")`,
  `CREATE INDEX IF NOT EXISTS "rbac_roles_is_active_idx" ON "rbac_roles"("is_active")`,
  `CREATE INDEX IF NOT EXISTS "rbac_role_permissions_permission_id_idx" ON "rbac_role_permissions"("permission_id")`,
  `CREATE INDEX IF NOT EXISTS "rbac_user_roles_role_id_idx" ON "rbac_user_roles"("role_id")`,
  `CREATE INDEX IF NOT EXISTS "rbac_user_permissions_permission_id_idx" ON "rbac_user_permissions"("permission_id")`,

  // ── Accounting Module additions (v8) ───────────────────────────
  `DO $$ BEGIN
    CREATE TYPE "AccountType" AS ENUM ('INCOME','EXPENSE','ASSET','LIABILITY','EQUITY');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "accounts" (
    "code"        TEXT          NOT NULL PRIMARY KEY,
    "name"        TEXT          NOT NULL,
    "parent_code" TEXT,
    "type"        "AccountType" NOT NULL,
    "tenant_id"   TEXT          NOT NULL,
    "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id"                 TEXT          NOT NULL PRIMARY KEY,
    "tenant_id"          TEXT          NOT NULL,
    "account_code"       TEXT          NOT NULL,
    "type"               TEXT          NOT NULL,
    "date"               TIMESTAMP(3)  NOT NULL,
    "contact_name"       TEXT,
    "memo"               TEXT,
    "split_account_code" TEXT,
    "debit"              DECIMAL(12,2) NOT NULL,
    "credit"             DECIMAL(12,2) NOT NULL,
    "cleared_status"     BOOLEAN       NOT NULL DEFAULT false,
    "created_at"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `DO $$ BEGIN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_account_code_fkey"
      FOREIGN KEY ("account_code") REFERENCES "accounts"("code") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "accounts_parent_code_idx" ON "accounts"("parent_code")`,
  `CREATE INDEX IF NOT EXISTS "accounts_tenant_id_idx"   ON "accounts"("tenant_id")`,
  `CREATE INDEX IF NOT EXISTS "journal_entries_account_code_idx" ON "journal_entries"("account_code")`,
  `CREATE INDEX IF NOT EXISTS "journal_entries_tenant_id_idx"    ON "journal_entries"("tenant_id")`,
  `CREATE INDEX IF NOT EXISTS "journal_entries_date_idx"         ON "journal_entries"("date")`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "materials" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "properties" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "deals" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "transactions_deal_id_idx" ON "transactions"("deal_id")`,
  `CREATE INDEX IF NOT EXISTS "transactions_deleted_at_date_idx" ON "transactions"("deleted_at", "date")`,
  `CREATE INDEX IF NOT EXISTS "transactions_deleted_at_type_date_idx" ON "transactions"("deleted_at", "type", "date")`,
  `CREATE INDEX IF NOT EXISTS "materials_name_idx" ON "materials"("name")`,
  `CREATE INDEX IF NOT EXISTS "materials_created_at_idx" ON "materials"("created_at")`,
  `CREATE INDEX IF NOT EXISTS "rent_payments_contract_id_idx" ON "rent_payments"("contract_id")`,

  // ── Workforce Contracts Module additions (v10) ─────────────────
  `DO $$ BEGIN
    CREATE TYPE "WorkforceContractStatus" AS ENUM ('DRAFT','ACTIVE','COMPLETED','CANCELLED','SUSPENDED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "workforce_contracts" (
    "id"              TEXT                     NOT NULL PRIMARY KEY,
    "project_id"      TEXT                     NOT NULL,
    "title"           TEXT                     NOT NULL,
    "description"     TEXT,
    "contractor_name" TEXT,
    "original_budget" DECIMAL(12,2)            NOT NULL,
    "total_paid"      DECIMAL(12,2)            NOT NULL DEFAULT 0,
    "status"          "WorkforceContractStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date"      TIMESTAMP(3),
    "end_date"        TIMESTAMP(3),
    "notes"           TEXT,
    "version"         INTEGER                  NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"      TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "workforce_contract_workers" (
    "id"          TEXT          NOT NULL PRIMARY KEY,
    "contract_id" TEXT          NOT NULL,
    "staff_id"    TEXT,
    "worker_id"   TEXT,
    "role"        TEXT,
    "notes"       TEXT,
    "assigned_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at"  TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "workforce_contract_payments" (
    "id"             TEXT          NOT NULL PRIMARY KEY,
    "contract_id"    TEXT          NOT NULL,
    "staff_id"       TEXT,
    "worker_id"      TEXT,
    "payee_name"     TEXT,
    "amount"         DECIMAL(12,2) NOT NULL,
    "date"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description"    TEXT          NOT NULL,
    "recorded_by_id" TEXT          NOT NULL,
    "notes"          TEXT,
    "created_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "workforce_contract_adjustments" (
    "id"             TEXT          NOT NULL PRIMARY KEY,
    "contract_id"    TEXT          NOT NULL,
    "amount"         DECIMAL(12,2) NOT NULL,
    "reason"         TEXT          NOT NULL,
    "adjusted_by_id" TEXT          NOT NULL,
    "created_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `DO $$ BEGIN
    ALTER TABLE "daily_operational_expenses" ADD COLUMN "recorded_by_user_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contracts" ADD COLUMN "contractor_name" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contracts" ADD CONSTRAINT "workforce_contracts_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_workers" ADD COLUMN "worker_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `ALTER TABLE "workforce_contract_workers" ALTER COLUMN "staff_id" DROP NOT NULL`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_payments" ADD COLUMN "worker_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_workers" ADD CONSTRAINT "workforce_contract_workers_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "workforce_contracts"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_workers" ADD CONSTRAINT "workforce_contract_workers_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_workers" ADD CONSTRAINT "workforce_contract_workers_worker_id_fkey"
      FOREIGN KEY ("worker_id") REFERENCES "manpower_workers"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_payments" ADD CONSTRAINT "workforce_contract_payments_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "workforce_contracts"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_payments" ADD CONSTRAINT "workforce_contract_payments_worker_id_fkey"
      FOREIGN KEY ("worker_id") REFERENCES "manpower_workers"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_payments" ADD COLUMN "payee_name" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `ALTER TABLE "workforce_contract_payments" ALTER COLUMN "staff_id" DROP NOT NULL`,

  `ALTER TABLE "workforce_contract_payments" DROP CONSTRAINT IF EXISTS "workforce_contract_payments_staff_id_fkey"`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_payments" ADD CONSTRAINT "workforce_contract_payments_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_payments" ADD CONSTRAINT "workforce_contract_payments_recorded_by_id_fkey"
      FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_adjustments" ADD CONSTRAINT "workforce_contract_adjustments_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "workforce_contracts"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_adjustments" ADD CONSTRAINT "workforce_contract_adjustments_adjusted_by_id_fkey"
      FOREIGN KEY ("adjusted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "daily_operational_expenses" ADD CONSTRAINT "daily_operational_expenses_recorded_by_user_id_fkey"
      FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "workforce_contracts_project_id_idx" ON "workforce_contracts"("project_id")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contracts_status_idx" ON "workforce_contracts"("status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "workforce_contract_workers_contract_id_staff_id_key" ON "workforce_contract_workers"("contract_id", "staff_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "workforce_contract_workers_contract_id_worker_id_key" ON "workforce_contract_workers"("contract_id", "worker_id")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contract_workers_staff_id_idx" ON "workforce_contract_workers"("staff_id")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contract_workers_worker_id_idx" ON "workforce_contract_workers"("worker_id")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contract_payments_contract_id_idx" ON "workforce_contract_payments"("contract_id")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contract_payments_staff_id_idx" ON "workforce_contract_payments"("staff_id")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contract_payments_worker_id_idx" ON "workforce_contract_payments"("worker_id")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contract_payments_date_idx" ON "workforce_contract_payments"("date")`,
  `CREATE INDEX IF NOT EXISTS "workforce_contract_adjustments_contract_id_idx" ON "workforce_contract_adjustments"("contract_id")`,
  `CREATE INDEX IF NOT EXISTS "daily_operational_expenses_recorded_by_user_id_idx" ON "daily_operational_expenses"("recorded_by_user_id")`,
  `CREATE INDEX IF NOT EXISTS "daily_operational_expenses_worker_id_idx" ON "daily_operational_expenses"("worker_id")`,
  `CREATE INDEX IF NOT EXISTS "worker_ledger_entries_worker_id_idx" ON "worker_ledger_entries"("worker_id")`,
  `CREATE INDEX IF NOT EXISTS "manpower_workers_worker_type_id_idx" ON "manpower_workers"("worker_type_id")`,
  `CREATE INDEX IF NOT EXISTS "manpower_workers_assigned_project_id_idx" ON "manpower_workers"("assigned_project_id")`,
  `CREATE INDEX IF NOT EXISTS "manpower_workers_status_idx" ON "manpower_workers"("status")`,
  `CREATE INDEX IF NOT EXISTS "manpower_workers_deleted_at_idx" ON "manpower_workers"("deleted_at")`,

  `DO $$ BEGIN
    ALTER TABLE "workforce_contract_workers" DROP COLUMN IF EXISTS "daily_rate";
  EXCEPTION WHEN others THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "categories" ADD COLUMN "code" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "categories_code_key" ON "categories"("code")`,

  // ── Payroll & Payslips Tables ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "payrolls" (
    "id"                   TEXT        NOT NULL PRIMARY KEY,
    "name"                 TEXT        NOT NULL,
    "year"                 INTEGER     NOT NULL,
    "month"                INTEGER     NOT NULL,
    "pay_period"           TEXT,
    "payment_date"         TIMESTAMP(3),
    "status"               "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "rejection_reason"     TEXT,
    "total_base_salary"    NUMERIC(12,2) NOT NULL DEFAULT 0,
    "total_bonuses"        NUMERIC(12,2) NOT NULL DEFAULT 0,
    "total_deductions"     NUMERIC(12,2) NOT NULL DEFAULT 0,
    "total_tax"            NUMERIC(12,2) NOT NULL DEFAULT 0,
    "total_gross_salary"   NUMERIC(12,2) NOT NULL DEFAULT 0,
    "total_net_salary"     NUMERIC(12,2) NOT NULL DEFAULT 0,
    "expense_account_code" TEXT,
    "project_id"           TEXT,
    "created_by_id"        TEXT,
    "approved_by_id"       TEXT,
    "approved_at"          TIMESTAMP(3),
    "paid_at"              TIMESTAMP(3),
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"           TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "payroll_items" (
    "id"                  TEXT        NOT NULL PRIMARY KEY,
    "payroll_id"          TEXT        NOT NULL,
    "staff_id"            TEXT,
    "employee_name"       TEXT        NOT NULL,
    "employee_position"   TEXT,
    "employee_department" "Department" NOT NULL DEFAULT 'GENERAL',
    "base_salary"         NUMERIC(12,2) NOT NULL DEFAULT 0,
    "bonuses"             NUMERIC(12,2) NOT NULL DEFAULT 0,
    "deductions"          NUMERIC(12,2) NOT NULL DEFAULT 0,
    "tax"                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    "gross_salary"        NUMERIC(12,2) NOT NULL DEFAULT 0,
    "net_salary"          NUMERIC(12,2) NOT NULL DEFAULT 0,
    "payslip_number"      TEXT,
    "status"              "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "notes"               TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `DO $$ BEGIN
    ALTER TABLE "payrolls" ADD COLUMN "project_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_approved_by_id_fkey"
      FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_expense_account_code_fkey"
      FOREIGN KEY ("expense_account_code") REFERENCES "accounts"("code") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_id_fkey"
      FOREIGN KEY ("payroll_id") REFERENCES "payrolls"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_staff_id_fkey"
      FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "payrolls_status_idx" ON "payrolls"("status")`,
  `CREATE INDEX IF NOT EXISTS "payrolls_year_month_idx" ON "payrolls"("year", "month")`,
  `CREATE INDEX IF NOT EXISTS "payrolls_deleted_at_created_at_idx" ON "payrolls"("deleted_at", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "payrolls_project_id_idx" ON "payrolls"("project_id")`,
  // One active payroll per (year, month). A plain unique index on
  // (year, month, deleted_at) lets NULL deleted_at rows duplicate, so this
  // partial index enforces the invariant only for active rows.
  `CREATE UNIQUE INDEX IF NOT EXISTS "payrolls_year_month_active_key" ON "payrolls"("year", "month") WHERE "deleted_at" IS NULL`,
  `CREATE INDEX IF NOT EXISTS "payroll_items_payroll_id_idx" ON "payroll_items"("payroll_id")`,
  `CREATE INDEX IF NOT EXISTS "payroll_items_staff_id_idx" ON "payroll_items"("staff_id")`,
  `CREATE INDEX IF NOT EXISTS "payroll_items_payslip_number_idx" ON "payroll_items"("payslip_number")`,

  // ── Full Accounting Module — Phase 1 (v15) ─────────────────────
  //
  // Extends the minimal accounts + journal_entries tables with:
  //   1) Descriptive/status/policy columns on accounts.
  //   2) A new journal_batches table so double-entry lines are grouped
  //      into balanced batches (SUM(debit) = SUM(credit) per batch).
  //   3) A batch_id link on journal_entries with a self-consistent
  //      DR/CR line invariant.
  //   4) A seeded default Chart of Accounts so posting works out of
  //      the box before the mappings UI (phase 2) is available.
  //
  // ---- accounts: extend ----
  `DO $$ BEGIN
    ALTER TABLE "accounts" ADD COLUMN "description" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "accounts" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "accounts" ADD COLUMN "allow_negative" BOOLEAN NOT NULL DEFAULT true;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "accounts" ADD COLUMN "normal_balance" TEXT NOT NULL DEFAULT 'DEBIT';
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "accounts" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_normal_balance_check"
      CHECK ("normal_balance" IN ('DEBIT','CREDIT'));
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_code_fkey"
      FOREIGN KEY ("parent_code") REFERENCES "accounts"("code") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "accounts_is_active_idx" ON "accounts"("is_active")`,

  // ---- journal_batches: new ----
  `CREATE TABLE IF NOT EXISTS "journal_batches" (
    "id"                     TEXT           NOT NULL PRIMARY KEY,
    "tenant_id"              TEXT           NOT NULL,
    "batch_number"           TEXT           NOT NULL,
    "date"                   TIMESTAMP(3)   NOT NULL,
    "memo"                   TEXT,
    "source_type"            TEXT           NOT NULL DEFAULT 'MANUAL',
    "source_id"              TEXT,
    "source_ref"             TEXT,
    "status"                 TEXT           NOT NULL DEFAULT 'POSTED',
    "total_debit"            DECIMAL(14,2)  NOT NULL DEFAULT 0,
    "total_credit"           DECIMAL(14,2)  NOT NULL DEFAULT 0,
    "posted_by_id"           TEXT,
    "posted_at"              TIMESTAMP(3),
    "reverses_batch_id"      TEXT,
    "reversed_by_batch_id"   TEXT,
    "version"                INTEGER        NOT NULL DEFAULT 0,
    "created_at"             TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"             TIMESTAMP(3)
  )`,

  `DO $$ BEGIN
    ALTER TABLE "journal_batches" ADD CONSTRAINT "journal_batches_status_check"
      CHECK ("status" IN ('POSTED','PENDING_APPROVAL','REVERSED','VOID'));
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "journal_batches" ADD CONSTRAINT "journal_batches_balanced_check"
      CHECK ("total_debit" = "total_credit");
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "journal_batches" ADD CONSTRAINT "journal_batches_posted_by_id_fkey"
      FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "journal_batches" ADD CONSTRAINT "journal_batches_reverses_batch_id_fkey"
      FOREIGN KEY ("reverses_batch_id") REFERENCES "journal_batches"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "journal_batches" ADD CONSTRAINT "journal_batches_reversed_by_batch_id_fkey"
      FOREIGN KEY ("reversed_by_batch_id") REFERENCES "journal_batches"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "journal_batches_batch_number_key" ON "journal_batches"("batch_number")`,
  `CREATE INDEX IF NOT EXISTS "journal_batches_date_idx"        ON "journal_batches"("date")`,
  `CREATE INDEX IF NOT EXISTS "journal_batches_status_idx"      ON "journal_batches"("status")`,
  `CREATE INDEX IF NOT EXISTS "journal_batches_source_idx"      ON "journal_batches"("source_type","source_id")`,
  `CREATE INDEX IF NOT EXISTS "journal_batches_deleted_date_idx" ON "journal_batches"("deleted_at","date")`,

  // ---- journal_entries: link to batch, add line ordering ----
  `DO $$ BEGIN
    ALTER TABLE "journal_entries" ADD COLUMN "batch_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "journal_entries" ADD COLUMN "line_number" INTEGER NOT NULL DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "journal_batches"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // A line is EITHER a debit OR a credit (never both, never zero).
  `DO $$ BEGIN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_dr_or_cr_check"
      CHECK (("debit" > 0 AND "credit" = 0) OR ("debit" = 0 AND "credit" > 0));
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "journal_entries_batch_id_idx" ON "journal_entries"("batch_id")`,

  // ---- transaction linkage to journal batch (traceability) ----
  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD COLUMN "journal_batch_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD COLUMN "posting_status" TEXT NOT NULL DEFAULT 'UNPOSTED';
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_posting_status_check"
      CHECK ("posting_status" IN ('UNPOSTED','POSTED','REVERSED','FAILED'));
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_journal_batch_id_fkey"
      FOREIGN KEY ("journal_batch_id") REFERENCES "journal_batches"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "transactions_journal_batch_id_idx" ON "transactions"("journal_batch_id")`,

  // ---- Seed default Chart of Accounts (idempotent) ----
  //
  // Uses tenant_id='system' as the sentinel for seeded rows. The
  // per-tenant Postgres database already provides isolation; the
  // tenant_id column on accounts is retained for schema symmetry
  // only and no service filters by it. Anyone can rename/inactivate
  // these accounts later — codes are stable so mappings keep working.
  //
  // Numbering scheme (US-standard 4-digit):
  //   1000 Assets, 2000 Liabilities, 3000 Equity, 4000 Income, 5000 Expense
  `INSERT INTO "accounts" ("code","name","parent_code","type","tenant_id","description","normal_balance","allow_negative","is_system")
   VALUES
     ('1000','Assets',              NULL,   'ASSET',    'system','Root: everything the company owns',                 'DEBIT',  false, true),
     ('1100','Cash and Bank',       '1000', 'ASSET',    'system','Physical cash and bank balances',                   'DEBIT',  false, true),
     ('1110','Cash on Hand',        '1100', 'ASSET',    'system','Petty cash and cash drawers',                       'DEBIT',  false, true),
     ('1120','Bank Account',        '1100', 'ASSET',    'system','Primary operating bank account',                    'DEBIT',  false, true),
     ('1200','Accounts Receivable', '1000', 'ASSET',    'system','Amounts owed by customers',                         'DEBIT',  true,  true),
     ('1300','Inventory',           '1000', 'ASSET',    'system','Materials and goods held for sale',                 'DEBIT',  false, true),
     ('1400','Prepaid Expenses',    '1000', 'ASSET',    'system','Expenses paid in advance',                          'DEBIT',  false, true),
     ('1500','Fixed Assets',        '1000', 'ASSET',    'system','Property, plant and equipment',                     'DEBIT',  false, true),

     ('2000','Liabilities',         NULL,   'LIABILITY','system','Root: everything the company owes',                 'CREDIT', false, true),
     ('2100','Accounts Payable',    '2000', 'LIABILITY','system','Amounts owed to suppliers',                         'CREDIT', true,  true),
     ('2200','Tax Payable',         '2000', 'LIABILITY','system','Taxes collected but not yet remitted',              'CREDIT', true,  true),
     ('2300','Customer Deposits',   '2000', 'LIABILITY','system','Advances and deposits held for customers',          'CREDIT', true,  true),
     ('2400','Accrued Expenses',    '2000', 'LIABILITY','system','Expenses incurred but not yet paid',                'CREDIT', true,  true),

     ('3000','Equity',              NULL,   'EQUITY',   'system','Root: owners equity',                               'CREDIT', true,  true),
     ('3100','Owner Capital',       '3000', 'EQUITY',   'system','Owner contributions',                               'CREDIT', true,  true),
     ('3900','Retained Earnings',   '3000', 'EQUITY',   'system','Accumulated earnings',                              'CREDIT', true,  true),

     ('4000','Income',              NULL,   'INCOME',   'system','Root: all revenue',                                 'CREDIT', true,  true),
     ('4100','Sales Revenue',       '4000', 'INCOME',   'system','Revenue from goods sold',                           'CREDIT', true,  true),
     ('4200','Service Revenue',     '4000', 'INCOME',   'system','Revenue from services rendered',                    'CREDIT', true,  true),
     ('4300','Rental Income',       '4000', 'INCOME',   'system','Revenue from property rentals',                     'CREDIT', true,  true),
     ('4400','Other Income',        '4000', 'INCOME',   'system','Miscellaneous income',                              'CREDIT', true,  true),

     ('5000','Expenses',            NULL,   'EXPENSE',  'system','Root: all expenses',                                'DEBIT',  true,  true),
     ('5100','Cost of Goods Sold',  '5000', 'EXPENSE',  'system','Direct cost of goods sold',                         'DEBIT',  true,  true),
     ('5200','Salaries and Wages',  '5000', 'EXPENSE',  'system','Payroll expense',                                   'DEBIT',  true,  true),
     ('5300','Rent Expense',        '5000', 'EXPENSE',  'system','Office/site rental expense',                        'DEBIT',  true,  true),
     ('5400','Utilities',           '5000', 'EXPENSE',  'system','Electricity, water, internet',                      'DEBIT',  true,  true),
     ('5500','Operating Expenses',  '5000', 'EXPENSE',  'system','General operating expenses',                        'DEBIT',  true,  true),
     ('5600','Discounts Given',     '5000', 'EXPENSE',  'system','Sales/settlement discounts given to customers',     'DEBIT',  true,  true),
     ('5900','Other Expenses',      '5000', 'EXPENSE',  'system','Miscellaneous expenses',                            'DEBIT',  true,  true)
   ON CONFLICT ("code") DO NOTHING`,

  // ── Full Accounting Module — Phase 2 (v16) ─────────────────────
  //
  // account_mappings drives every auto-posting hook. Each row binds a
  // stable key (TRANSACTION_INCOME_CASH, SALES_INVOICE_AR, …) to a
  // Chart-of-Accounts code. Services call AccountMappingsService.resolve()
  // instead of hardcoding codes so mappings can be re-pointed at any time
  // from Settings without a code change.
  `CREATE TABLE IF NOT EXISTS "account_mappings" (
    "key"            TEXT          NOT NULL PRIMARY KEY,
    "account_code"   TEXT          NOT NULL,
    "description"    TEXT,
    "updated_by_id"  TEXT,
    "created_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `DO $$ BEGIN
    ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_account_code_fkey"
      FOREIGN KEY ("account_code") REFERENCES "accounts"("code") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "account_mappings_account_code_idx" ON "account_mappings"("account_code")`,

  // Seed the default mapping set. Codes mirror the phase-1 hardcoded
  // constants so this migration is a no-op for auto-posting behavior;
  // once landed, admins can re-point any key from Settings.
  `INSERT INTO "account_mappings" ("key","account_code","description")
   VALUES
     -- Core transactions (Financials page — the informal ledger)
     ('TRANSACTION_INCOME_CASH',     '1120','Cash/bank account debited on quick income entries'),
     ('TRANSACTION_INCOME_REVENUE',  '4400','Revenue account credited on quick income entries'),
     ('TRANSACTION_EXPENSE_CASH',    '1120','Cash/bank account credited on quick expense entries'),
     ('TRANSACTION_EXPENSE_ACCOUNT', '5900','Expense account debited on quick expense entries'),
     ('OWNER_SUPPORT_CAPITAL',       '3100','Owner capital credited when the owner personally funds an expense'),
     -- Sales invoices / customer flow
     ('SALES_INVOICE_AR',            '1200','Receivable debited when a sales invoice is issued'),
     ('SALES_INVOICE_REVENUE',       '4100','Revenue credited when a sales invoice is issued'),
     ('CUSTOMER_PAYMENT_CASH',       '1120','Cash/bank debited on customer payments received'),
     ('CUSTOMER_PAYMENT_AR',         '1200','Receivable credited on customer payments received'),
     ('CUSTOMER_DEPOSIT_LIABILITY',  '2300','Deposit liability credited when a deposit is held'),
     -- Purchases / supplier flow
     ('PURCHASE_INVOICE_AP',         '2100','Payable credited when a purchase invoice is entered'),
     ('PURCHASE_INVOICE_EXPENSE',    '5100','Cost/expense debited when a purchase invoice is entered'),
     ('SUPPLIER_PAYMENT_CASH',       '1120','Cash/bank credited when paying suppliers'),
     ('SUPPLIER_PAYMENT_AP',         '2100','Payable debited when paying suppliers'),
     -- Rentals (real estate)
     ('RENTAL_INVOICE_AR',           '1200','Tenant receivable debited when a rent invoice is issued'),
     ('RENTAL_INVOICE_REVENUE',      '4300','Rental income credited when a rent invoice is issued'),
     ('RENTAL_RECEIPT_CASH',         '1120','Cash/bank debited on rent receipts'),
     ('RENTAL_RECEIPT_AR',           '1200','Tenant receivable credited on rent receipts'),
     -- Real estate sale
     ('DEAL_SALE_REVENUE',           '4100','Revenue credited on real estate sale'),
     ('DEAL_SALE_CASH',              '1120','Cash/bank debited on real estate sale'),
     -- Payroll
     ('PAYROLL_EXPENSE',             '5200','Salary expense debited on payroll run'),
     ('PAYROLL_CASH',                '1120','Cash/bank credited on payroll payout'),
     -- Tax and discount
     ('TAX_PAYABLE',                 '2200','Tax payable credited on taxable transactions'),
     ('DISCOUNT_GIVEN',              '5600','Discount-given expense debited when a discount is applied'),
     -- Defaults / fallbacks
     ('DEFAULT_CASH',                '1120','Fallback cash account when nothing more specific applies'),
     ('DEFAULT_INCOME',              '4400','Fallback income account when nothing more specific applies'),
     ('DEFAULT_EXPENSE',             '5900','Fallback expense account when nothing more specific applies')
   ON CONFLICT ("key") DO NOTHING`,

  // Merge real-estate "clients" into "tenants" (Tenant is a strict superset of
  // Client's columns). Deals now reference tenants directly; the old clients
  // table is left in place, untouched, for a later cleanup once verified.
  `INSERT INTO "tenants" ("id", "name", "email", "phone", "notes", "created_at", "updated_at", "deleted_at")
   SELECT "id", "name", "email", "phone", "notes", "created_at", "updated_at", "deleted_at"
   FROM "clients"
   ON CONFLICT ("id") DO NOTHING`,

  `ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_client_id_fkey"`,

  `DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ── Transactions: manual linking to a material (v18) ────────────
  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD COLUMN "material_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "transactions_material_id_idx" ON "transactions"("material_id")`,

  // ── Construction module: independent material inventory, decoupled
  // from the Material Management module's "materials" table (v23) ──
  `CREATE TABLE IF NOT EXISTS "construction_materials" (
    "id"         TEXT         NOT NULL PRIMARY KEY,
    "name"       TEXT         NOT NULL,
    "category"   TEXT,
    "material_type" TEXT,
    "photo_url"  TEXT,
    "quantity"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit"       "UnitType"    NOT NULL,
    "unit_cost"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warehouse"  TEXT,
    "low_stock_threshold" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status"     "MaterialProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "version"    INTEGER       NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3)
  )`,

  `CREATE TABLE IF NOT EXISTS "construction_inventory_transactions" (
    "id"          TEXT                       NOT NULL PRIMARY KEY,
    "material_id" TEXT                       NOT NULL,
    "project_id"  TEXT,
    "type"        "InventoryTransactionType" NOT NULL,
    "quantity"    DECIMAL(12,2)              NOT NULL,
    "date"        TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id"     TEXT                       NOT NULL,
    "supplier_id"    TEXT,
    "payment_method" TEXT,
    "unit_cost"      DECIMAL(12,2),
    "total_cost"     DECIMAL(12,2),
    "source_ref"     TEXT,
    "notes"       TEXT,
    "warehouse"   TEXT,
    "created_at"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMP(3)
  )`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD COLUMN "supplier_id" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD COLUMN "payment_method" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD COLUMN "unit_cost" DECIMAL(12,2);
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD COLUMN "total_cost" DECIMAL(12,2);
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD COLUMN "source_ref" TEXT;
  EXCEPTION WHEN duplicate_column THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD CONSTRAINT "construction_inventory_transactions_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "construction_materials"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD CONSTRAINT "construction_inventory_transactions_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD CONSTRAINT "construction_inventory_transactions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "construction_inventory_transactions" ADD CONSTRAINT "construction_inventory_transactions_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE INDEX IF NOT EXISTS "construction_materials_name_idx" ON "construction_materials"("name")`,
  `CREATE INDEX IF NOT EXISTS "construction_materials_created_at_idx" ON "construction_materials"("created_at")`,
  `CREATE INDEX IF NOT EXISTS "construction_inventory_transactions_material_id_idx" ON "construction_inventory_transactions"("material_id")`,
  `CREATE INDEX IF NOT EXISTS "construction_inventory_transactions_project_id_idx" ON "construction_inventory_transactions"("project_id")`,
  `CREATE INDEX IF NOT EXISTS "construction_inventory_transactions_date_idx" ON "construction_inventory_transactions"("date")`,
  `CREATE INDEX IF NOT EXISTS "construction_inventory_transactions_type_project_id_date_idx" ON "construction_inventory_transactions"("type", "project_id", "date")`,
  `CREATE INDEX IF NOT EXISTS "construction_inventory_transactions_supplier_id_idx" ON "construction_inventory_transactions"("supplier_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "construction_inventory_transactions_source_ref_key" ON "construction_inventory_transactions"("source_ref")`,
];

/**
 * Apply the tenant schema to a provisioned company database and record the schema version.
 *
 * Uses pure SQL via pg.Pool — no Prisma CLI binary required.
 * All statements are idempotent (IF NOT EXISTS + DO...EXCEPTION blocks).
 */
export async function applyCompanySchema(companyDbUrl: string, onboardingId?: string) {
  const { directUrl } = getDatabaseConnectionPair(companyDbUrl);
  const pool = new Pool({
    connectionString: directUrl,
    max: 1,
    connectionTimeoutMillis: connectionTimeoutMillis(),
    keepAlive: true,
  });

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    console.log(`[applyCompanySchema] Applying ${TENANT_SCHEMA_STATEMENTS.length} DDL statements in a single batch...`);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('maamulpro-schema'))");
    if (onboardingId) await assertEmptyOrOwned(client, onboardingId);

    const batchSql = TENANT_SCHEMA_STATEMENTS
      .map(stmt => {
        const trimmed = stmt.trim();
        return trimmed.endsWith(";") ? trimmed : trimmed + ";";
      })
      .join("\n");

    await client.query(batchSql);

    // Upsert the schema version to track auto-migrations
    await client.query(`
      INSERT INTO "system_config" ("id", "key", "value", "created_at", "updated_at")
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE SET "value" = $3, "updated_at" = CURRENT_TIMESTAMP
    `, ["schema_version_record", "schema_version", String(CURRENT_TENANT_SCHEMA_VERSION)]);

    if (onboardingId) {
      await client.query(`INSERT INTO "system_config" ("id","key","value","created_at","updated_at")
        VALUES ($1,'onboarding_attempt_id',$1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT ("key") DO NOTHING`, [onboardingId]);
    }
    await client.query("COMMIT");
    console.log(`[applyCompanySchema] Schema (v${CURRENT_TENANT_SCHEMA_VERSION}) applied successfully.`);
  } catch (err) {
    await client?.query("ROLLBACK").catch(cleanupError => console.error(JSON.stringify({ event: 'schema_rollback_failed', onboardingId, original: setupDiagnostic(err), cleanup: setupDiagnostic(cleanupError) })));
    throw err;
  } finally {
    client?.release();
    await pool.end().catch(cleanupError => console.error(JSON.stringify({ event: 'schema_pool_close_failed', onboardingId, cleanup: setupDiagnostic(cleanupError) })));
  }
}
