import type { AuditEvent } from "../../shared/sim.js";

export const fmt = (n: number, maxDigits = 4) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: maxDigits });
export const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
export const signedMoney = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
export const pct = (n: number, d = 2) => `${n.toFixed(d)}%`;
export const clock = (sec: number) =>
  new Date(sec * 1000).toLocaleString("en-GB", {
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const clockSeconds = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

/** Quote every field and neutralise spreadsheet formula injection. */
const cell = (v: string | number) => {
  const s = String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
};
export const eventsToCsv = (events: AuditEvent[]) =>
  [
    "time_utc,type,message",
    ...events.map((e) =>
      [new Date(e.time * 1000).toISOString(), e.type, e.message].map(cell).join(","),
    ),
  ].join("\n");

export function downloadText(filename: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
