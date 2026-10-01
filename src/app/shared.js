"use client";

/**
 * Small building blocks shared by the manager dashboard and the "My progress" tab.
 */

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Score → colour token, matching the practice screen. */
export function scoreColor(score) {
  if (score >= 85) return "var(--good)";
  if (score >= 60) return "var(--warn)";
  return "var(--bad)";
}

/** "2026-10-01T12:00:00+00:00" → "Oct 1, 02:00 PM" (local time). Safe on bad input. */
export function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date);
}

/** "2026-10-01" → "Oct 1". Parsed as local noon to avoid off-by-one timezone shifts. */
export function formatDay(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? isoDate : dayFormat.format(date);
}

/* -------------------------------------------------------------------------- */
/* Presentational components                                                  */
/* -------------------------------------------------------------------------- */

/** One headline KPI. */
export function StatCard({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone ?? ""}`} aria-hidden="true">
        <Icon size={20} />
      </div>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        {hint && <p className="stat-hint">{hint}</p>}
      </div>
    </div>
  );
}

/** Small dependency-free SVG line chart of the daily team average (0–100). */
export function TrendChart({ points, days = 14 }) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (points.length === 0) {
    return <p className="muted">{`Not enough data yet. Scores from the last ${days} days will appear here.`}</p>;
  }

  const x = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (score) => pad.top + innerH - (score / 100) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.average_score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Daily average score over the last ${days} days`}
    >
      {[0, 50, 100].map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#334155" strokeDasharray="4 4" />
          <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
            {tick}
          </text>
        </g>
      ))}
      <path d={area} fill="rgba(99,102,241,0.15)" />
      <path d={line} fill="none" stroke="#818cf8" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.date} cx={x(i)} cy={y(p.average_score)} r="4.5" fill="#818cf8" stroke="#1e293b" strokeWidth="2">
          <title>{`${formatDay(p.date)}: ${p.average_score} avg (${p.sessions} session${p.sessions === 1 ? "" : "s"})`}</title>
        </circle>
      ))}
      <text x={x(0)} y={height - 8} textAnchor={points.length === 1 ? "middle" : "start"} fontSize="11" fill="#94a3b8">
        {formatDay(points[0].date)}
      </text>
      {points.length > 1 && (
        <text x={x(points.length - 1)} y={height - 8} textAnchor="end" fontSize="11" fill="#94a3b8">
          {formatDay(points[points.length - 1].date)}
        </text>
      )}
    </svg>
  );
}

