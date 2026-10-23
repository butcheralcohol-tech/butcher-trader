export type LiveExecutionPreflight = {
  explicitApproval: boolean;
  oauthSessionVerified: boolean;
  brokerAccountId: string;
  brokerAccountType: "demo" | "real" | "wallet" | "unknown";
  demoOrderLifecycleVerified: boolean;
  brokerSettlementReconciliationVerified: boolean;
  persistentWorkerHealthy: boolean;
  durableRiskStoreHealthy: boolean;
  cumulativeHardStopEnforced: boolean;
  hardStopClosesSocketAndStopsWorker: boolean;
  minimumStakeValidated: boolean;
  singleOrderFirstRunEnforced: boolean;
  marketHoursChecked: boolean;
  perTradeRiskLimitEnforced: boolean;
  perMarketLossLimitEnforced: boolean;
  sessionLossLimitEnforced: boolean;
  dailyLossLimitEnforced: boolean;
};

export type LiveExecutionDecision = {
  allowed: boolean;
  reasons: string[];
};

/**
 * Fail-closed gate for a future live execution path.
 * This is deliberately separate from configuration: caller-provided booleans alone
 * cannot switch trading on. The deployment policy must explicitly permit live orders
 * after this gate and a reviewed, integrated broker execution implementation exist.
 */
export function evaluateLiveExecutionPreflight(
  checks: LiveExecutionPreflight,
  policyAllowsLiveTrading = false,
): LiveExecutionDecision {
  const reasons: string[] = [];
  if (!policyAllowsLiveTrading) reasons.push("Live trading is disabled by deployment policy.");
  if (!checks.explicitApproval) reasons.push("Explicit live-trading approval is missing.");
  if (!checks.oauthSessionVerified) reasons.push("Deriv OAuth session is not verified server-side.");
  if (!/^CR\d+$/.test(checks.brokerAccountId) || checks.brokerAccountType !== "real") {
    reasons.push("Only a broker-verified CR real account is eligible; wallet and virtual accounts are blocked.");
  }
  if (!checks.demoOrderLifecycleVerified) reasons.push("End-to-end demo order lifecycle has not been verified.");
  if (!checks.brokerSettlementReconciliationVerified) reasons.push("Broker settlement reconciliation is not verified.");
  if (!checks.persistentWorkerHealthy) reasons.push("Persistent trading worker is not confirmed healthy.");
  if (!checks.durableRiskStoreHealthy) reasons.push("Durable risk storage is not confirmed healthy.");
  if (!checks.cumulativeHardStopEnforced) reasons.push("Cumulative hard stop-loss is not enforced.");
  if (!checks.hardStopClosesSocketAndStopsWorker) reasons.push("Hard stop does not prove it closes the broker socket and stops the worker.");
  if (!checks.minimumStakeValidated) reasons.push("Broker minimum stake validation is missing.");
  if (!checks.singleOrderFirstRunEnforced) reasons.push("Single-order first-run restriction is missing.");
  if (!checks.marketHoursChecked) reasons.push("Forex market-hours validation is missing.");
  if (!checks.perTradeRiskLimitEnforced) reasons.push("Per-trade risk limit is not enforced.");
  if (!checks.perMarketLossLimitEnforced) reasons.push("Per-market loss limit is not enforced.");
  if (!checks.sessionLossLimitEnforced) reasons.push("Session loss limit is not enforced.");
  if (!checks.dailyLossLimitEnforced) reasons.push("Daily loss limit is not enforced.");
  return { allowed: reasons.length === 0, reasons };
}
