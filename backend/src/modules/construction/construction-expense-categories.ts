export type ConstructionExpenseSection = 'manpower' | 'materials' | 'expenses';

export const CONSTRUCTION_EXPENSE_CATEGORIES = [
  { value: 'UNSKILLED_LABOR', label: 'Unskilled Labor', code: 'CEXP_UNSKILLED', section: 'manpower', debitKey: 'PAYROLL_EXPENSE', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: [] },
  { value: 'LABOR', label: 'Labor', code: 'CEXP_LABOR', section: 'manpower', debitKey: 'PAYROLL_EXPENSE', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: ['Labor Expense'] },
  { value: 'MATERIALS', label: 'Materials', code: 'CEXP_MATERIALS', section: 'materials', debitKey: 'PURCHASE_INVOICE_EXPENSE', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: ['Material', 'Construction Materials'] },
  { value: 'EQUIPMENT', label: 'Equipment', code: 'CEXP_EQUIPMENT', section: 'expenses', debitKey: 'TRANSACTION_EXPENSE_ACCOUNT', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: [] },
  { value: 'TRANSPORT', label: 'Transport', code: 'CEXP_TRANSPORT', section: 'expenses', debitKey: 'TRANSACTION_EXPENSE_ACCOUNT', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: ['Transportation'] },
  { value: 'UTILITIES', label: 'Utilities', code: 'CEXP_UTILITIES', section: 'expenses', debitKey: 'TRANSACTION_EXPENSE_ACCOUNT', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: [] },
  { value: 'FOOD', label: 'Food', code: 'CEXP_FOOD', section: 'expenses', debitKey: 'TRANSACTION_EXPENSE_ACCOUNT', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: [] },
  { value: 'SUPPORT_COSTS', label: 'Owner Support', code: 'CEXP_OWNER_SUPPORT', section: 'expenses', debitKey: 'TRANSACTION_EXPENSE_ACCOUNT', creditKey: 'OWNER_SUPPORT_CAPITAL', aliases: ['Support Costs'] },
  { value: 'OTHER', label: 'Other', code: 'CEXP_OTHER', section: 'expenses', debitKey: 'TRANSACTION_EXPENSE_ACCOUNT', creditKey: 'TRANSACTION_EXPENSE_CASH', aliases: [] },
] as const;

export const CONSTRUCTION_EXPENSE_CATEGORY_VALUES = CONSTRUCTION_EXPENSE_CATEGORIES.map(({ value }) => value);

const comparable = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');

export function constructionExpenseCategory(value?: string | null) {
  const key = comparable(value || 'OTHER');
  return CONSTRUCTION_EXPENSE_CATEGORIES.find((category) =>
    [category.value, category.label, category.code, ...category.aliases].some((candidate) => comparable(candidate) === key),
  ) || CONSTRUCTION_EXPENSE_CATEGORIES.at(-1)!;
}

