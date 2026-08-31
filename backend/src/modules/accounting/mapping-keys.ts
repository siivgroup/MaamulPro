// ─────────────────────────────────────────────────────────────
// Account Mapping Keys
//
// Central registry of every stable mapping key used by auto-posting.
// Adding a new key here is safe — the seed migration inserts an
// initial row; if a tenant DB is missing that row, resolve() falls
// back to `defaultCode` so services never crash on an unmapped key.
//
// Keys are ORDER-STABLE strings — never rename an existing key,
// only add new ones. Renaming breaks in-flight postings and any
// tenant-configured mappings that reference the old name.
// ─────────────────────────────────────────────────────────────

export interface MappingKeyDef {
  key: string;
  label: string;
  category: string;
  defaultCode: string;
  description: string;
  suggestedTypes?: Array<'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'>;
}

export const MAPPING_KEYS: MappingKeyDef[] = [
  // Core transactions
  { key: 'TRANSACTION_INCOME_CASH',    label: 'Quick income — cash side',    category: 'Transactions',  defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Cash/bank account debited on quick income entries' },
  { key: 'TRANSACTION_INCOME_REVENUE', label: 'Quick income — revenue side', category: 'Transactions',  defaultCode: '4400', suggestedTypes: ['INCOME'],    description: 'Revenue account credited on quick income entries' },
  { key: 'TRANSACTION_EXPENSE_CASH',   label: 'Quick expense — cash side',   category: 'Transactions',  defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Cash/bank account credited on quick expense entries' },
  { key: 'TRANSACTION_EXPENSE_ACCOUNT',label: 'Quick expense — expense side',category: 'Transactions',  defaultCode: '5900', suggestedTypes: ['EXPENSE'],   description: 'Expense account debited on quick expense entries' },
  { key: 'OWNER_SUPPORT_CAPITAL',      label: 'Owner-funded expense — capital side', category: 'Transactions', defaultCode: '3100', suggestedTypes: ['EQUITY'], description: 'Owner capital credited when the owner personally funds an expense' },

  // Sales
  { key: 'SALES_INVOICE_AR',           label: 'Sales invoice — AR',          category: 'Sales',         defaultCode: '1200', suggestedTypes: ['ASSET'],     description: 'Receivable debited when a sales invoice is issued' },
  { key: 'SALES_INVOICE_REVENUE',      label: 'Sales invoice — revenue',     category: 'Sales',         defaultCode: '4100', suggestedTypes: ['INCOME'],    description: 'Revenue credited when a sales invoice is issued' },
  { key: 'CUSTOMER_PAYMENT_CASH',      label: 'Customer payment — cash',     category: 'Sales',         defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Cash/bank debited on customer payments received' },
  { key: 'CUSTOMER_PAYMENT_AR',        label: 'Customer payment — AR',       category: 'Sales',         defaultCode: '1200', suggestedTypes: ['ASSET'],     description: 'Receivable credited on customer payments received' },
  { key: 'CUSTOMER_DEPOSIT_LIABILITY', label: 'Customer deposit — liability',category: 'Sales',         defaultCode: '2300', suggestedTypes: ['LIABILITY'], description: 'Deposit liability credited when a deposit is held' },

  // Purchases
  { key: 'PURCHASE_INVOICE_AP',        label: 'Purchase invoice — AP',       category: 'Purchases',     defaultCode: '2100', suggestedTypes: ['LIABILITY'], description: 'Payable credited when a purchase invoice is entered' },
  { key: 'PURCHASE_INVOICE_EXPENSE',   label: 'Purchase invoice — expense',  category: 'Purchases',     defaultCode: '5100', suggestedTypes: ['EXPENSE'],   description: 'Cost/expense debited when a purchase invoice is entered' },
  { key: 'SUPPLIER_PAYMENT_CASH',      label: 'Supplier payment — cash',     category: 'Purchases',     defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Cash/bank credited when paying suppliers' },
  { key: 'SUPPLIER_PAYMENT_AP',        label: 'Supplier payment — AP',       category: 'Purchases',     defaultCode: '2100', suggestedTypes: ['LIABILITY'], description: 'Payable debited when paying suppliers' },

  // Rentals
  { key: 'RENTAL_INVOICE_AR',          label: 'Rent invoice — AR',           category: 'Rentals',       defaultCode: '1200', suggestedTypes: ['ASSET'],     description: 'Tenant receivable debited when a rent invoice is issued' },
  { key: 'RENTAL_INVOICE_REVENUE',     label: 'Rent invoice — revenue',      category: 'Rentals',       defaultCode: '4300', suggestedTypes: ['INCOME'],    description: 'Rental income credited when a rent invoice is issued' },
  { key: 'RENTAL_RECEIPT_CASH',        label: 'Rent receipt — cash',         category: 'Rentals',       defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Cash/bank debited on rent receipts' },
  { key: 'RENTAL_RECEIPT_AR',          label: 'Rent receipt — AR',           category: 'Rentals',       defaultCode: '1200', suggestedTypes: ['ASSET'],     description: 'Tenant receivable credited on rent receipts' },

  // Real estate sale
  { key: 'DEAL_SALE_REVENUE',          label: 'Real-estate sale — revenue',  category: 'Real estate',   defaultCode: '4100', suggestedTypes: ['INCOME'],    description: 'Revenue credited on real estate sale' },
  { key: 'DEAL_SALE_CASH',             label: 'Real-estate sale — cash',     category: 'Real estate',   defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Cash/bank debited on real estate sale' },

  // Payroll
  { key: 'PAYROLL_EXPENSE',            label: 'Payroll — salary expense',    category: 'Payroll',       defaultCode: '5200', suggestedTypes: ['EXPENSE'],   description: 'Salary expense debited on payroll run' },
  { key: 'PAYROLL_CASH',               label: 'Payroll — payout cash',       category: 'Payroll',       defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Cash/bank credited on payroll payout' },
  { key: 'PAYROLL_TAX_PAYABLE',        label: 'Payroll — tax payable',       category: 'Payroll',       defaultCode: '2200', suggestedTypes: ['LIABILITY'], description: 'Tax withholdings credited on payroll payout' },
  { key: 'PAYROLL_DEDUCTIONS_PAYABLE', label: 'Payroll — deductions payable',category: 'Payroll',       defaultCode: '2200', suggestedTypes: ['LIABILITY'], description: 'Other payroll deductions credited on payroll payout' },

  // Tax and discount
  { key: 'TAX_PAYABLE',                label: 'Tax payable',                 category: 'Tax & discount',defaultCode: '2200', suggestedTypes: ['LIABILITY'], description: 'Tax payable credited on taxable transactions' },
  { key: 'DISCOUNT_GIVEN',             label: 'Discount given',              category: 'Tax & discount',defaultCode: '5600', suggestedTypes: ['EXPENSE'],   description: 'Discount-given expense debited when a discount is applied' },

  // Defaults
  { key: 'DEFAULT_CASH',               label: 'Default cash account',        category: 'Defaults',      defaultCode: '1120', suggestedTypes: ['ASSET'],     description: 'Fallback cash account when nothing more specific applies' },
  { key: 'DEFAULT_INCOME',             label: 'Default income account',      category: 'Defaults',      defaultCode: '4400', suggestedTypes: ['INCOME'],    description: 'Fallback income account when nothing more specific applies' },
  { key: 'DEFAULT_EXPENSE',            label: 'Default expense account',     category: 'Defaults',      defaultCode: '5900', suggestedTypes: ['EXPENSE'],   description: 'Fallback expense account when nothing more specific applies' },
];

export const MAPPING_KEY_INDEX = new Map<string, MappingKeyDef>(
  MAPPING_KEYS.map((m) => [m.key, m]),
);

export type MappingKey = string;
