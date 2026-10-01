"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Download, RefreshCw, TrendingUp, Users } from "lucide-react";
import { StatCard, TrendChart, formatDateTime, scoreColor } from "./shared";

/**
 * Corporate Manager Dashboard.
 *
 * Data comes from GET /api/dashboard, which the backend only serves to emails listed in
 * MANAGER_EMAILS. The browser never talks to the scores table directly, so employee data
 * stays protected even though the Supabase anon key is public.
 *
 * Props:
 *   getAccessToken  async () => string | null   returns the current Supabase access token
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Loading placeholder that mirrors the final layout, so the page doesn't jump. */
function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading team analytics">
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat-card skeleton" style={{ height: 92 }} />
        ))}
      </div>
      <div className="card skeleton" style={{ height: 280 }} />
      <div className="card skeleton" style={{ height: 220 }} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export default function Dashboard({ getAccessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coachingOnly, setCoachingOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  /** Fetches analytics from the backend. Aborts cleanly if the view unmounts. */
  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Your session has expired. Please sign in again.");

        const response = await fetch("/api/dashboard", {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.detail || `Request failed (${response.status}).`);
        setData(body);
      } catch (err) {
        if (err.name === "AbortError") return;
        setError(err.message || "Couldn't load the dashboard.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [getAccessToken]
  );

  /** Downloads the recent attempts as a CSV file (manager-only endpoint). */
  const exportCsv = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch("/api/dashboard/export", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Export failed (${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "echo-english-scores.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Couldn't export the data.");
    } finally {
      setExporting(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** Employees after the "needs coaching" toggle and the email search are applied. */
  const visibleEmployees = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.employees.filter(
      (e) => (!coachingOnly || e.needs_coaching) && (!needle || e.email.includes(needle))
    );
  }, [data, coachingOnly, query]);

  /* ---- States ---- */

  if (loading && !data) return <DashboardSkeleton />;

  if (error && !data) {
    return (
      <div className="card" role="alert">
        <p className="card-label">Couldn't load dashboard</p>
        <p style={{ margin: "0 0 16px" }}>{error}</p>
        <button className="primary-btn" style={{ width: "auto", padding: "10px 20px" }} onClick={() => load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const empty = data.total_sessions === 0;

  return (
    <div>
      <div className="dash-toolbar">
        <div>
          <h2 style={{ margin: 0 }}>Team overview</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            Employees below a recent average of {data.coaching_threshold} are flagged for coaching.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost-btn" onClick={exportCsv} disabled={exporting || data.total_sessions === 0}>
            <Download size={16} /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
          <button className="ghost-btn" onClick={() => load()} disabled={loading} aria-label="Refresh data">
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {data.truncated && (
        <div className="error" role="status" style={{ background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.4)", color: "#fde68a" }}>
          Showing the most recent sessions only. Older history is excluded from averages.
        </div>
      )}

      {/* KPIs */}
      <div className="stat-grid">
        <StatCard icon={TrendingUp} label="Average team fluency" value={empty ? "—" : `${data.average_score}`} hint="out of 100" />
        <StatCard icon={Activity} label="Practice sessions" value={data.total_sessions.toLocaleString()} hint="completed in total" />
        <StatCard icon={Users} label="Active employees" value={data.active_employees} hint="have practiced" />
        <StatCard
          icon={data.needs_coaching_count > 0 ? AlertTriangle : CheckCircle2}
          tone={data.needs_coaching_count > 0 ? "tone-warn" : "tone-good"}
          label="Need extra coaching"
          value={data.needs_coaching_count}
          hint={data.needs_coaching_count > 0 ? "recent average below target" : "everyone is on track"}
        />
      </div>

      {empty ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ margin: 0 }}>No practice sessions yet. Once employees record attempts, their results will show up here.</p>
        </div>
      ) : (
        <>
          {/* Trend */}
          <section className="card" aria-labelledby="trend-title">
            <p className="card-label" id="trend-title">
              <span>Average score, last 14 days</span>
            </p>
            <TrendChart points={data.trend} />
          </section>

          {/* Employees */}
          <section className="card" aria-labelledby="employees-title">
            <p className="card-label" id="employees-title">
              <span>Employees</span>
            </p>
            <div className="filter-row">
              <input
                type="search"
                className="text-input"
                placeholder="Search by email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search employees by email"
              />
              <label className="check">
                <input type="checkbox" checked={coachingOnly} onChange={(e) => setCoachingOnly(e.target.checked)} />
                Needs coaching only
              </label>
            </div>

            {visibleEmployees.length === 0 ? (
              <p className="muted">No employees match your filters.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th className="num">Sessions</th>
                      <th className="num">Average</th>
                      <th className="num">Recent</th>
                      <th>Last active</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEmployees.map((e) => (
                      <tr key={e.email}>
                        <td className="email-cell">{e.email}</td>
                        <td className="num">{e.sessions}</td>
                        <td className="num">{e.average_score}</td>
                        <td className="num" style={{ color: scoreColor(e.recent_average), fontWeight: 700 }}>
                          {e.recent_average}
                        </td>
                        <td>{formatDateTime(e.last_active)}</td>
                        <td>
                          {e.needs_coaching ? (
                            <span className="badge badge-warn">Needs coaching</span>
                          ) : (
                            <span className="badge badge-good">On track</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* History */}
          <section className="card" aria-labelledby="history-title">
            <p className="card-label" id="history-title">
              <span>Recent attempts</span>
              <span>latest {data.recent_attempts.length}</span>
            </p>
            <ul className="attempts">
              {data.recent_attempts.map((a) => (
                <li key={a.id}>
                  <div className="attempt-head">
                    <span className="email-cell">{a.user_email}</span>
                    <span className="attempt-score" style={{ color: scoreColor(a.score) }}>
                      {a.score}
                    </span>
                  </div>
                  <p className="attempt-line">
                    <strong>Target:</strong> {a.expected_text}
                  </p>
                  <p className="attempt-line muted">
                    <strong>Heard:</strong> {a.actual_text || "—"}
                  </p>
                  <p className="attempt-time">{formatDateTime(a.created_at)}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
