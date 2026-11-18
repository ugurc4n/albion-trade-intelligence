import { z } from "zod";
import { CAERLEON, ROYAL_CITIES, SERVER_IDS, type ServerId } from "@/lib/albion/constants";
import { DEFAULT_FEES } from "@/lib/profit/fees";

export const RISK_PREFERENCES = ["conservative", "balanced", "aggressive"] as const;
export type RiskPreference = (typeof RISK_PREFERENCES)[number];

export const RISK_PREFERENCE_LABELS: Record<RiskPreference, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

const rate = z.number().min(0).max(0.5);

export const feeConfigSchema = z.object({
  setupFeeRate: rate.default(DEFAULT_FEES.setupFeeRate),
  salesTaxRatePremium: rate.default(DEFAULT_FEES.salesTaxRatePremium),
  salesTaxRateNonPremium: rate.default(DEFAULT_FEES.salesTaxRateNonPremium),
  expectedRelists: z.number().min(0).max(10).default(DEFAULT_FEES.expectedRelists),
});

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  server: z.enum(SERVER_IDS as [ServerId, ...ServerId[]]).default("europe"),
  homeCity: z.enum(ROYAL_CITIES).default("Martlock"),
  premium: z.boolean().default(false),
  totalSilver: z.number().int().min(0).max(1e13).default(14_000_000),
  tradeBudget: z.number().int().min(0).max(1e13).default(3_000_000),
  fees: feeConfigSchema.default(DEFAULT_FEES),
  /** Minimum ROI as a fraction (0.05 = 5%). */
  minRoi: z.number().min(-1).max(10).default(0.05),
  maxDataAgeMinutes: z.number().int().min(5).max(7 * 24 * 60).default(120),
  riskPreference: z.enum(RISK_PREFERENCES).default("balanced"),
  /** Optional transport cost assumption in silver per kg moved between cities. */
  transportCostPerKg: z.number().min(0).max(1e6).default(0),
  /** Optional carrying capacity per trip in kg; null = not limited. */
  carryCapacityKg: z.number().min(1).max(1e6).nullable().default(null),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Caerleon is only a valid buy market on the Black Market page; the other scanners never see a Caerleon quote. */
const cityFilter = z.union([z.enum(ROYAL_CITIES), z.literal(CAERLEON), z.literal("all")]);
const numOrNull = z.number().nullable();

export const filtersSchema = z.object({
  buyCity: cityFilter.default("all"),
  sellCity: cityFilter.default("all"),
  tiers: z.array(z.number().int().min(1).max(8)).default([]),
  enchants: z.array(z.number().int().min(0).max(4)).default([]),
  categories: z.array(z.string().max(40)).max(30).default([]),
  qualities: z.array(z.number().int().min(1).max(5)).default([]),
  scenarios: z.array(z.enum(["instant-order", "order-order", "order-instant", "instant-instant"])).default([]),
  risks: z.array(z.enum(["low", "medium", "high"])).default([]),
  /** Overrides settings.minRoi when set. */
  minRoi: numOrNull.default(null),
  minProfit: numOrNull.default(null),
  /** Maximum capital per opportunity (caps the recommended quantity). */
  maxInvestment: numOrNull.default(null),
  /** Overrides settings.maxDataAgeMinutes when set. */
  maxDataAgeMinutes: numOrNull.default(null),
  search: z.string().max(80).default(""),
  itemId: z.string().max(80).nullable().default(null),
  includeStale: z.boolean().default(false),
  includeUnprofitable: z.boolean().default(false),
});

export type Filters = z.infer<typeof filtersSchema>;
export const DEFAULT_FILTERS: Filters = filtersSchema.parse({});

export const opportunitiesRequestSchema = z.object({
  settings: settingsSchema,
  filters: filtersSchema.default(DEFAULT_FILTERS),
  /** "all" = flips + trades (Dashboard, Optimizer). The Black Market is only scanned when asked for explicitly. */
  kind: z.enum(["flip", "trade", "blackmarket", "all"]).default("all"),
  limit: z.number().int().min(1).max(2000).default(500),
});

export type OpportunitiesRequest = z.infer<typeof opportunitiesRequestSchema>;
