export const PLAN_FEATURE_KEYS = [
  'construction',
  'realEstate',
  'materials',
  'payroll',
  'advancedReports',
  'prioritySupport',
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];
export type PlanFeatures = Record<PlanFeatureKey, boolean>;
export type PlanLimits = {
  users: number;
  constructionProjects: number;
  properties: number;
};

export type PlanEntitlements = {
  planId?: string;
  planKey?: string;
  planName?: string;
  features: PlanFeatures;
  limits: PlanLimits;
};

const aliases: Record<PlanFeatureKey, string[]> = {
  construction: ['construction', 'constructionEnabled'],
  realEstate: ['realEstate', 'real_estate', 'realEstateEnabled'],
  materials: ['materials', 'materialManagement', 'materialManagementEnabled'],
  payroll: ['payroll', 'payrollEnabled'],
  advancedReports: ['advancedReports', 'reports', 'reporting'],
  prioritySupport: ['prioritySupport'],
};

export function normalizePlanFeatures(value: unknown): PlanFeatures {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    PLAN_FEATURE_KEYS.map((key) => [
      key,
      aliases[key].some((alias) => source[alias] === true),
    ]),
  ) as PlanFeatures;
}

export function normalizeLimit(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

export function planEntitlements(plan: any): PlanEntitlements {
  return {
    planId: plan?.id,
    planKey: plan?.key,
    planName: plan?.name,
    features: normalizePlanFeatures(plan?.features),
    limits: {
      users: normalizeLimit(plan?.usersMax, 5),
      constructionProjects: normalizeLimit(plan?.constructionMax),
      properties: normalizeLimit(plan?.propertiesMax),
    },
  };
}

export function isAtLimit(current: number, limit: number): boolean {
  // A zero capacity means unlimited. Disabled modules are enforced separately.
  return limit > 0 && current >= limit;
}

/** Calendar months in UTC; clamp the original day to the destination month. */
export function addBillingMonths(startAt: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 1 || !Number.isFinite(startAt.getTime())) {
    throw new Error('A valid billing date and positive whole number of months are required');
  }
  const result = new Date(startAt);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function addBillingPeriod(startAt: Date, billingCycle: string): Date {
  return addBillingMonths(startAt, billingCycle === 'YEARLY' ? 12 : 1);
}

export function legacyPlanTier(key?: string | null) {
  const normalized = String(key || '').trim().toUpperCase();
  return ['FREE', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'].includes(normalized)
    ? normalized
    : null;
}

export function hasSubscriptionAccess(company: any, now = new Date()): boolean {
  return company?.status === 'ACTIVE'
    && company?.subscriptionStatus === 'ACTIVE'
    && company?.accessGranted === true
    && Boolean(company?.subscriptionExpiresAt)
    && new Date(company.subscriptionExpiresAt).getTime() > now.getTime();
}
