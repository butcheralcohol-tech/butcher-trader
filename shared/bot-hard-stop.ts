export type HardStopConfig = {
  /** Absolute loss ceiling for the current bot run, in account currency. */
  maxRunLoss: number;
  /** Maximum number of buy requests permitted in this process/run. */
  maxOrdersPerRun: number;
};

export type HardStopSnapshot = {
  cumulativeSettledPnl: number;
  settledTrades: number;
  ordersPlaced: number;
  stopped: boolean;
  reason: string | null;
};

export type HardStopEvent =
  | { type: "order_accepted" }
  | { type: "trade_settled"; profit: number }
  | { type: "broker_reconciliation"; cumulativePnl: number };

/**
 * In-memory fail-closed run guard. Feed it only broker-confirmed settlement P&L,
 * not open-contract mark-to-market values or client-supplied P&L.
 *
 * This is defense in depth, not durable account-wide protection: production must
 * persist the lock/P&L in shared storage and reconcile against broker history.
 */
export class BotHardStopGuard {
  private state: HardStopSnapshot = {
    cumulativeSettledPnl: 0,
    settledTrades: 0,
    ordersPlaced: 0,
    stopped: false,
    reason: null,
  };

  constructor(private readonly config: HardStopConfig) {
    if (!Number.isFinite(config.maxRunLoss) || config.maxRunLoss <= 0) {
      throw new Error("maxRunLoss must be a positive finite amount.");
    }
    if (!Number.isInteger(config.maxOrdersPerRun) || config.maxOrdersPerRun < 1) {
      throw new Error("maxOrdersPerRun must be a positive integer.");
    }
  }

  snapshot(): Readonly<HardStopSnapshot> {
    return { ...this.state };
  }

  canPlaceOrder(): boolean {
    return !this.state.stopped && this.state.ordersPlaced < this.config.maxOrdersPerRun;
  }

  record(event: HardStopEvent): Readonly<HardStopSnapshot> {
    if (this.state.stopped) return this.snapshot();

    if (event.type === "order_accepted") {
      if (this.state.ordersPlaced >= this.config.maxOrdersPerRun) {
        this.stop("Single-run order limit reached.");
        return this.snapshot();
      }
      this.state.ordersPlaced += 1;
      if (this.state.ordersPlaced >= this.config.maxOrdersPerRun) {
        // Allow the accepted order to finish/settle, but do not allow another order.
        this.state.reason = "Single-run order limit reached; no further orders allowed.";
      }
      return this.snapshot();
    }

    if (event.type === "trade_settled") {
      if (!Number.isFinite(event.profit)) {
        this.stop("Invalid settlement P&L; trading halted pending reconciliation.");
        return this.snapshot();
      }
      this.state.cumulativeSettledPnl += event.profit;
      this.state.settledTrades += 1;
      if (this.state.cumulativeSettledPnl <= -this.config.maxRunLoss) {
        this.stop("Bot run loss ceiling reached.");
      }
      return this.snapshot();
    }

    if (!Number.isFinite(event.cumulativePnl)) {
      this.stop("Invalid broker reconciliation; trading halted.");
      return this.snapshot();
    }
    this.state.cumulativeSettledPnl = event.cumulativePnl;
    if (this.state.cumulativeSettledPnl <= -this.config.maxRunLoss) {
      this.stop("Broker-reconciled run loss ceiling reached.");
    }
    return this.snapshot();
  }

  private stop(reason: string): void {
    this.state.stopped = true;
    this.state.reason = reason;
  }
}
