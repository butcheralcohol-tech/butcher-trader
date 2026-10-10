import { useEffect, useRef, useState } from "react";
import type { Candle } from "../../shared/types.js";
import { fmt } from "../lib/format";

export type Overlay = { label: string; color: string; values: number[] };
export type Marker = { time: number; price: number; kind: "entry" | "win" | "loss" };
type Props = { candles: Candle[]; overlays?: Overlay[]; markers?: Marker[]; height?: number };

const UP = "#5cd59c", DOWN = "#ed6069";

export default function CandleChart({ candles, overlays = [], markers = [], height = 280 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => setWidth(Math.max(280, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padR = 64, padT = 10, padB = 20, plotW = width - padR, plotH = height - padT - padB;
  const visible = Math.max(20, Math.floor(plotW / 7)), start = Math.max(0, candles.length - visible), view = candles.slice(start);
  if (view.length < 2) return <div ref={box} className="chart-empty tall" style={{ height }}>Waiting for candles…</div>;

  const ovView = overlays.map(o => ({ ...o, values: o.values.slice(start) }));
  let lo = Math.min(...view.map(c => c.low)), hi = Math.max(...view.map(c => c.high));
  for (const o of ovView) for (const v of o.values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = hi - lo || Math.abs(hi) * 0.001 || 1;
  lo -= span * 0.05; hi += span * 0.05;
  const y = (p: number) => padT + ((hi - p) / (hi - lo)) * plotH;
  const slot = plotW / visible, shift = visible - view.length, x = (i: number) => (i + shift) * slot + slot / 2;
  const bodyW = Math.max(1, slot * 0.68);
  const grid = [0, 1, 2, 3, 4].map(k => lo + ((hi - lo) * k) / 4);
  const indexByTime = new Map(view.map((c, i) => [c.time, i]));
  const shown = hover !== null && hover < view.length ? view[hover] : view[view.length - 1];
  const t = (sec: number) => new Date(sec * 1000).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" });

  return <div ref={box} className="candle-wrap">
    <div className="ohlc-line"><span>{new Date(shown.time * 1000).toLocaleString("en-GB", { hour12: false })}</span>
      <span>O <b>{fmt(shown.open)}</b></span><span>H <b>{fmt(shown.high)}</b></span><span>L <b>{fmt(shown.low)}</b></span><span>C <b>{fmt(shown.close)}</b></span>
      {overlays.map(o => <span key={o.label} style={{ color: o.color }}>{o.label}</span>)}</div>
    <svg width={width} height={height} role="img" aria-label="Candlestick chart" onMouseLeave={() => setHover(null)}
      onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.min(view.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / slot - shift)))); }}>
      {grid.map(g => <g key={g}><line x1={0} x2={plotW} y1={y(g)} y2={y(g)} stroke="#1d1d22" /><text x={plotW + 6} y={y(g) + 3} fill="#6d6d75" fontSize="9" fontFamily="DM Mono, monospace">{fmt(g)}</text></g>)}
      {view.map((c, i) => { const up = c.close >= c.open, col = up ? UP : DOWN, top = y(Math.max(c.open, c.close)), h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
        return <g key={c.time}><line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} /><rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={h} fill={col} /></g>; })}
      {ovView.map(o => <polyline key={o.label} fill="none" stroke={o.color} strokeWidth="1.4" points={o.values.map((v, i) => (Number.isFinite(v) ? `${x(i)},${y(v)}` : "")).filter(Boolean).join(" ")} />)}
      {markers.map((m, k) => { const i = indexByTime.get(m.time); if (i === undefined) return null; const cx = x(i), cy = y(m.price), col = m.kind === "entry" ? "#e5a344" : m.kind === "win" ? UP : DOWN;
        return <polygon key={k} points={`${cx},${cy - 5} ${cx - 4},${cy + 3} ${cx + 4},${cy + 3}`} fill={col} stroke="#09090b" />; })}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="#55555d" strokeDasharray="3 3" />}
      <text x={0} y={height - 4} fill="#6d6d75" fontSize="9" fontFamily="DM Mono, monospace">{t(view[0].time)}</text>
      <text x={plotW} y={height - 4} fill="#6d6d75" fontSize="9" textAnchor="end" fontFamily="DM Mono, monospace">{t(view[view.length - 1].time)}</text>
    </svg></div>;
}
