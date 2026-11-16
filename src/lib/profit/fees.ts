/**
 * Market fee assumptions. These could NOT be verified against an official 2026 Sandbox Interactive source;
 * they come from community guides and must be checked against the in-game market window.
 * All values are user-editable in Settings.
 */
export type FeeConfig = {
  /** Non-refundable setup fee charged when placing a buy order or a sell order. */
  setupFeeRate: number;
  /** Sales tax deducted from every sale (sell order fill or instant sell) — Premium accounts. */
  salesTaxRatePremium: number;
  /** Sales tax deducted from every sale — accounts without Premium. */
  salesTaxRateNonPremium: number;
  /** Expected number of times a sell order is re-listed (each re-list re-pays the setup fee). */
  expectedRelists: number;
};

export const DEFAULT_FEES: FeeConfig = {
  setupFeeRate: 0.025,
  salesTaxRatePremium: 0.04,
  salesTaxRateNonPremium: 0.08,
  expectedRelists: 1,
};

export const FEE_ASSUMPTION_NOTE =
  "Assumption: Setup Fee 2.5% (Buy Order and Sell Order, non-refundable), Sales Tax 4% with Premium / 8% without. Instant Buy has no fee, Instant Sell pays only Sales Tax. Not verified against an official source — check the in-game market screen.";

export function salesTaxRate(fees: FeeConfig, premium: boolean): number {
  return premium ? fees.salesTaxRatePremium : fees.salesTaxRateNonPremium;
}
