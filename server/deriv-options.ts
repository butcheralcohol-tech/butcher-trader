import { WebSocket } from "ws";

const API_BASE = "https://api.derivws.com/trading/v1";
const OPEN_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type OptionsAccount = {
  account_id: string;
  account_type: "demo" | "real" | string;
  currency: string;
  status?: string;
};

type ApiEnvelope<T> = { data?: T; errors?: Array<{ message?: string; code?: string }> };
type OptionsMessage = {
  req_id?: number;
  msg_type?: string;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
};

export function isDemoOptionsAccountId(accountId: string): boolean {
  // The current Options API uses DOT-prefixed account IDs. Never accept CR real accounts
  // or wallet IDs; account type is still independently enforced by the demo-only OTP URL.
  return /^DOT\\d+$/.test(accountId);
}

function safeApiError(payload: ApiEnvelope<unknown>, status: number): Error {
  const code = payload.errors?.[0]?.code;
  return new Error(`Deriv Options REST request failed (HTTP ${status}${code ? `, ${code}` : ""}).`);
}

export class DerivOptionsClient {
  private ws: WebSocket | null = null;
  private nextRequestId = 1;
  private closed = false;

  private constructor(private readonly socketUrl: string) {}

  static async connect(input: {
    accessToken: string;
    accountId: string;
    appId?: string;
    fetchImpl?: typeof fetch;
    socketFactory?: (url: string) => WebSocket;
  }): Promise<DerivOptionsClient> {
    const { accessToken, accountId } = input;
    if (!accessToken || accessToken.length > 4096) throw new Error("A valid server-side Deriv access token is required.");
    // This worker foundation deliberately permits demo accounts only. Real account execution
    // must not be reachable through an accidental environment-variable change.
    if (!isDemoOptionsAccountId(accountId)) throw new Error("Only DOT-prefixed Deriv Options demo accounts are enabled in this worker.");
    const fetchImpl = input.fetchImpl ?? fetch;
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
    // OAuth access tokens do not need Deriv-App-ID; PATs do.
    if (input.appId) {
      if (!/^\d+$/.test(input.appId)) throw new Error("DERIV_APP_ID must be numeric.");
      headers["Deriv-App-ID"] = input.appId;
    }
    const response = await fetchImpl(`${API_BASE}/options/accounts/${encodeURIComponent(accountId)}/otp`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
    });
    let payload: ApiEnvelope<{ url?: string }>;
    try { payload = await response.json() as ApiEnvelope<{ url?: string }>; }
    catch { throw new Error("Deriv returned an unreadable OTP response."); }
    if (!response.ok) throw safeApiError(payload, response.status);
    const url = payload.data?.url;
    if (typeof url !== "string") throw new Error("Deriv OTP response did not include a WebSocket URL.");
    const parsed = new URL(url);
    if (parsed.protocol !== "wss:" || parsed.hostname !== "api.derivws.com" ||
        parsed.pathname !== "/trading/v1/options/ws/demo" || !parsed.searchParams.get("otp")) {
      throw new Error("Deriv returned an unexpected or non-demo WebSocket URL.");
    }
    const client = new DerivOptionsClient(url);
    const socketFactory = input.socketFactory ?? ((socketUrl: string) => new WebSocket(socketUrl));
    await client.open(socketFactory);
    return client;
  }

  private async open(socketFactory: (url: string) => WebSocket): Promise<void> {
    const socket = socketFactory(this.socketUrl);
    this.ws = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("Deriv Options WebSocket connection timed out."));
      }, OPEN_TIMEOUT_MS);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", () => { clearTimeout(timer); reject(new Error("Deriv Options WebSocket connection failed.")); });
      socket.once("close", () => { clearTimeout(timer); reject(new Error("Deriv Options WebSocket closed before connecting.")); });
    });
  }

  request<T extends OptionsMessage = OptionsMessage>(payload: Record<string, unknown>): Promise<T> {
    const socket = this.ws;
    if (!socket || this.closed || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Deriv Options session is not open."));
    }
    const req_id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Deriv Options response timed out; reconcile broker state before retrying."));
      }, REQUEST_TIMEOUT_MS);
      const onClose = () => { cleanup(); reject(new Error("Deriv Options connection closed during a request.")); };
      const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
        let message: OptionsMessage;
        try { message = JSON.parse(raw.toString()) as OptionsMessage; } catch { return; }
        if (message.req_id !== req_id) return;
        cleanup();
        if (message.error) {
          reject(new Error(`Deriv Options rejected request (${message.error.code ?? "API_ERROR"}).`));
          return;
        }
        resolve(message as T);
      };
      socket.on("message", onMessage);
      socket.once("close", onClose);
      socket.send(JSON.stringify({ ...payload, req_id }), error => {
        if (error) { cleanup(); reject(new Error("Could not send request to Deriv Options.")); }
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const socket = this.ws;
    this.ws = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { socket.terminate(); resolve(); }, 2_000);
      socket.once("close", () => { clearTimeout(timer); resolve(); });
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close(1000, "Worker stopped");
    });
  }
}

/** Build the current Deriv Options API proposal shape; never use legacy `symbol`. */
export function buildOptionsProposal(input: {
  underlyingSymbol: string;
  contractType: string;
  currency: string;
  stake: number;
  duration: number;
  durationUnit: "s" | "m" | "h" | "d" | "t";
}): Record<string, unknown> {
  if (!/^[A-Z0-9_]{2,30}$/.test(input.underlyingSymbol)) throw new Error("Invalid underlying symbol.");
  if (!/^[A-Z]{3,5}$/.test(input.currency)) throw new Error("Invalid account currency.");
  if (!Number.isFinite(input.stake) || input.stake <= 0) throw new Error("Stake must be positive.");
  if (!Number.isInteger(input.duration) || input.duration < 1) throw new Error("Duration must be a positive integer.");
  if (!/^[A-Z_]{2,24}$/.test(input.contractType)) throw new Error("Invalid contract type.");
  return {
    proposal: 1,
    amount: input.stake,
    basis: "stake",
    contract_type: input.contractType,
    currency: input.currency,
    duration: input.duration,
    duration_unit: input.durationUnit,
    underlying_symbol: input.underlyingSymbol,
  };
}
