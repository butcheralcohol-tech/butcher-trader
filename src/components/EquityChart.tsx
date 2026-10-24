import { fmt } from "../lib/format";

type Props = {
  points: { time: number; balance: number }[];
  splitTime?: number;
  baseline: number;
};

export default function EquityChart({ points, splitTime, baseline }: Props) {
  if (points.length < 2) return <div className="chart-empty">No closed trades to plot.</div>;

  const t0 = points[0].time;
  const t1 = points[points.length - 1].time || t0 + 1;
  const tx = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 600;

  const vals = points.map((p) => p.balance).concat(baseline);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const ty = (v: number) => 110 - ((v - lo) / span) * 100;

  return (
    <div className="equity-wrap">
      <svg viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Equity curve">
        <line
          x1="0"
          x2="600"
          y1={ty(baseline)}
          y2={ty(baseline)}
          stroke="#3a3a42"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        {splitTime !== undefined && (
          <line
            x1={tx(splitTime)}
            x2={tx(splitTime)}
            y1="0"
            y2="120"
            stroke="#e5a344"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          fill="none"
          stroke="#e0444e"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          points={points.map((p) => `${tx(p.time)},${ty(p.balance)}`).join(" ")}
        />
      </svg>
      <div className="equity-axis">
        <span>start ${fmt(baseline, 2)}</span>
        {splitTime !== undefined && <span className="amber">┆ out-of-sample →</span>}
        <span>end ${fmt(points[points.length - 1].balance, 2)}</span>
      </div>
    </div>
  );
}
