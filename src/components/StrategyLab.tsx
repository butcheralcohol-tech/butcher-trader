import { useState } from "react";
import { FlaskConical, Download, Play, SlidersHorizontal } from "lucide-react";
import { DEFAULT_BACKTEST, evaluateSplit, runBacktest, sweep, type BacktestConfig, type BacktestResult, type SplitResult, type SweepRow } from "../../shared/backtest.js";
import { GRANULARITIES } from "../../shared/candles.js";
import { clampParams, defaultParams, getStrategy, strategies, type Params } from "../../shared/strategy.js";
import type { Candle } from "../../shared/types.js";
import { fetchCandles } from "../lib/feed";
import { clock, fmt, money, signedMoney } from "../lib/format";
import { MARKETS } from "../lib/markets";
import EquityChart from "./EquityChart";
import MetricsGrid from "./Metrics";

type Loaded = { symbol: string; granularity: number; candles: Candle[] };
type Run = { split: SplitResult; full: BacktestResult; key: string };

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export default function StrategyLab() {
  const [symbol, setSymbol] = useState<string>("R_100");
  const [granularity, setGranularity] = useState(300);
  const [count, setCount] = useState(2500);
  const [strategyId, setStrategyId] = useState(strategies[0].id);
  const strategy = getStrategy(strategyId);
  const [params, setParams] = useState<Params>(defaultParams(strategy));
  const [cfg, setCfg] = useState<BacktestConfig>(DEFAULT_BACKTEST);
  const [data, setData] = useState<Loaded | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [rows, setRows] = useState<SweepRow[] | null>(null);
  const [busy, setBusy] = useState<"" | "load" | "run">("");
  const [error, setError] = useState("");

  const key = JSON.stringify([strategyId, params, cfg, data?.symbol, data?.granularity, data?.candles.length]);
  const stale = run !== null && run.key !== key;

  function pickStrategy(id: string) { const s = getStrategy(id); setStrategyId(s.id); setParams(defaultParams(s)); setRun(null); setRows(null); }
  const num = (setter: (v: number) => void) => (e: { target: { value: string } }) => setter(Number(e.target.value));

  async function load() {
    setBusy("load"); setError("");
    try { const candles = await fetchCandles(symbol, granularity, count); setData({ symbol, granularity, candles }); setRun(null); setRows(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load history."); }
    finally { setBusy(""); }
  }

  function execute() {
    if (!data) return;
    setError("");
    const p = clampParams(strategy, params);
    setRun({ split: evaluateSplit(data.candles, strategy, p, cfg, 0.3), full: runBacktest(data.candles, strategy, p, cfg), key });
  }

  async function optimise() {
    if (!data) return;
    setBusy("run"); setError("");
    await new Promise(r => setTimeout(r, 30)); // let the spinner paint before the synchronous sweep
    const grid: Record<string, number[]> = {};
    for (const spec of strategy.params.slice(0, 3)) {
      const vals = [spec.default * 0.7, spec.default, spec.default * 1.3].map(v => Math.min(spec.max, Math.max(spec.min, roundTo(v, spec.step))));
      grid[spec.key] = [...new Set(vals)];
    }
    try { setRows(sweep(data.candles, strategy, params, grid, cfg, 0.3, 15, 5)); } finally { setBusy(""); }
  }

  function exportTrades() {
    if (!run) return;
    const head = "id,side,entry_time_utc,exit_time_utc,entry,exit,pnl,r,exit_reason";
    const body = run.full.trades.map(t => [t.id, t.side, new Date(t.entryTime * 1000).toISOString(), new Date(t.exitTime * 1000).toISOString(), t.entry, t.exit, t.pnl.toFixed(4), t.r.toFixed(3), t.exitReason].join(","));
    const url = URL.createObjectURL(new Blob([[head, ...body].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `backtest-${strategyId}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const cfgField = (label: string, k: keyof BacktestConfig, extra: { min?: number; max?: number; step?: number } = {}) =>
    <label>{label}<input type="number" value={cfg[k] as number} onChange={num(v => setCfg({ ...cfg, [k]: v }))} {...extra} /></label>;
  const split = run?.split;
  const splitTime = data && split ? data.candles[split.splitIndex]?.time : undefined;

  return <div className="lab">
    <div className="section-heading"><div><div className="eyebrow">03 / RESEARCH</div><h3>Strategy lab</h3></div><span className="safe-label"><FlaskConical size={14} /> BACKTEST · DEMO DATA ONLY</span></div>

    <section className="bot-library"><div className="bot-library-head"><div><div className="eyebrow">PREBUILT STRATEGIES</div><h3>Bot library</h3></div><span className="safe-label"><FlaskConical size={14} /> PAPER / BACKTEST ONLY</span></div><div className="bot-cards">{strategies.map((bot, i) => <article className={strategyId === bot.id ? "bot-card selected" : "bot-card"} key={bot.id}><div className="bot-card-top"><span className="bot-number">BOT 0{i + 1}</span><span className="bot-mode">RESEARCH</span></div><h4>{bot.name}</h4><p>{bot.description}</p><div className="bot-card-foot"><span>{bot.params.length} tunable parameters</span><button className="ghost-btn small" onClick={() => pickStrategy(bot.id)}>{strategyId === bot.id ? "Selected" : "Configure"}</button></div></article>)}</div><p className="hint">These are strategy templates, not profit guarantees. Select one to configure and backtest it below before starting a paper session.</p></section>\n\n    <section className="panel"><div className="card-title"><SlidersHorizontal size={17} /><b>1 · Load market history</b></div>
      <div className="fields four">
        <label>Market<select value={symbol} onChange={e => setSymbol(e.target.value)}>{MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.name}</option>)}</select></label>
        <label>Timeframe<select value={granularity} onChange={e => setGranularity(Number(e.target.value))}>{GRANULARITIES.map(g => <option key={g.seconds} value={g.seconds}>{g.label}</option>)}</select></label>
        <label>Candles<select value={count} onChange={e => setCount(Number(e.target.value))}>{[1000, 2500, 5000].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>&nbsp;<button className="primary-btn" onClick={load} disabled={busy !== ""}><Download size={14} /> {busy === "load" ? "Loading…" : "Load history"}</button></label>
      </div>
      {data && <p className="hint">Loaded {data.candles.length} candles · {clock(data.candles[0].time)} → {clock(data.candles[data.candles.length - 1].time)}</p>}
    </section>

    <section className="panel"><div className="card-title"><SlidersHorizontal size={17} /><b>2 · Strategy and costs</b></div>
      <div className="fields four">
        <label>Strategy<select value={strategyId} onChange={e => pickStrategy(e.target.value)}>{strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {strategy.params.map(s => <label key={s.key}>{s.label}<input type="number" min={s.min} max={s.max} step={s.step} value={params[s.key]} onChange={num(v => setParams({ ...params, [s.key]: v }))} /></label>)}
      </div>
      <p className="hint">{strategy.description}</p>
      <div className="fields six">
        {cfgField("Start balance ($)", "initialBalance", { min: 10 })}{cfgField("Risk / trade (%) ≤ 1", "riskPercent", { min: 0.1, max: 1, step: 0.1 })}
        {cfgField("Daily loss lock (%) ≤ 3", "dailyLossLimitPercent", { min: 0.1, max: 3, step: 0.1 })}{cfgField("Fee per side (bps)", "feeBps", { min: 0, step: 0.5 })}
        {cfgField("Slippage (bps)", "slippageBps", { min: 0, step: 0.5 })}{cfgField("Max bars held", "maxHoldBars", { min: 1 })}
        {cfgField("Max leverage (×)", "maxLeverage", { min: 1, max: 20 })}
        <label>Shorting<select value={cfg.allowShort ? "yes" : "no"} onChange={e => setCfg({ ...cfg, allowShort: e.target.value === "yes" })}><option value="yes">Allowed</option><option value="no">Longs only</option></select></label>
      </div>
      <div className="btn-row">
        <button className="primary-btn" onClick={execute} disabled={!data || busy !== ""}><Play size={14} /> Run backtest</button>
        <button className="ghost-btn" onClick={optimise} disabled={!data || busy !== ""}>{busy === "run" ? "Sweeping…" : "Parameter sweep (in-sample ranked)"}</button>
      </div>
      {error && <div className="risk-result blocked"><b>{error}</b></div>}
    </section>

    {run && split && data && <section className="panel">
      <div className="card-title"><b>3 · Results</b><span className="card-status">{stale ? "SETTINGS CHANGED — RE-RUN" : `${run.full.candles} CANDLES`}</span></div>
      <div className={`verdict ${split.outOfSample.metrics.netPnl > 0 && split.outOfSample.metrics.trades >= 10 ? "ok" : "warn"}`}>{split.verdict}</div>
      <EquityChart points={run.full.equity} baseline={cfg.initialBalance} splitTime={splitTime} />
      <div className="two-col">
        <MetricsGrid title="In-sample (first 70%)" m={split.inSample.metrics} note={`${split.inSample.blockedSignals} signals blocked by risk gate`} />
        <MetricsGrid title="Out-of-sample (last 30%)" m={split.outOfSample.metrics} note="parameters were not tuned on this window" />
      </div>
      <div className="card-title spaced"><b>Trades</b><button className="ghost-btn small" onClick={exportTrades}><Download size={12} /> CSV</button></div>
      <div className="table-wrap"><table><thead><tr><th>Exit time</th><th>Side</th><th>Entry</th><th>Exit</th><th>Why</th><th>P&amp;L</th><th>R</th></tr></thead>
        <tbody>{run.full.trades.slice(-40).reverse().map(t => <tr key={t.id}><td>{clock(t.exitTime)}</td><td>{t.side}</td><td>{fmt(t.entry)}</td><td>{fmt(t.exit)}</td><td>{t.exitReason}</td><td className={t.pnl >= 0 ? "up" : "down"}>{signedMoney(t.pnl)}</td><td>{t.r.toFixed(2)}</td></tr>)}
          {!run.full.trades.length && <tr><td colSpan={7}>No trades. Try another market, timeframe or parameters.</td></tr>}</tbody></table></div>
      <p className="hint">Execution model: signal at candle close, fill at next open, stop assumed hit before target inside the same candle, fees and slippage charged, one position at a time, same risk gate as live checks. Final balance {money(run.full.metrics.finalBalance)}.</p>
    </section>}

    {rows && <section className="panel"><div className="card-title"><b>Parameter sweep</b><span className="card-status">RANKED BY IN-SAMPLE RETURN ONLY</span></div>
      {rows.length === 0 ? <p className="hint">No parameter set produced enough in-sample trades (15 minimum). Load more candles or use a faster timeframe.</p> :
        <div className="table-wrap"><table><thead><tr><th>Parameters</th><th>In-sample return</th><th>IS trades</th><th>Out-of-sample return</th><th>OOS trades</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{strategy.params.map(s => `${s.label}: ${r.params[s.key]}`).join(" · ")}</td><td className={r.inSample.returnPct >= 0 ? "up" : "down"}>{r.inSample.returnPct.toFixed(2)}%</td><td>{r.inSample.trades}</td><td className={r.outOfSample.returnPct >= 0 ? "up" : "down"}>{r.outOfSample.returnPct.toFixed(2)}%</td><td>{r.outOfSample.trades}</td><td><button className="ghost-btn small" onClick={() => { setParams(r.params); setRun(null); }}>Use</button></td></tr>)}</tbody></table></div>}
      <p className="hint">Picking the best in-sample row and then looking at the out-of-sample column is the honest test. If the right-hand column is worse or negative, the parameters were fitted to noise.</p></section>}

    <div className="warning-note"><b>Read this before trusting any number above</b><p>Backtests use a limited recent window of Deriv candles and a simplified fill model. Good results do not predict future profits, and synthetic indices are high risk. Forward-test on the paper trader before any other step.</p></div>
  </div>;
}
