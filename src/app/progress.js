"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, CalendarCheck, Flame, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import { StatCard, TrendChart, formatDateTime, scoreColor } from "./shared";

/**
 * "My progress" tab: an employee's own history, streak and trend.
 *
 * Data comes from GET /api/history, which only ever returns the signed-in user's own rows.
 * Employees can also delete their stored attempts (DELETE /api/history).
 *
 * Props:
 *   getAccessToken  async () => string | null
 */
export default function MyProgress({ getAccessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);

  /** Calls the history endpoint with the current token. */
  const request = useCallback(
    async (method, signal) => {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch("/api/history", { method, headers: { Authorization: `Bearer ${token}` }, signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail || `Request failed (${response.status}).`);
      return body;
    },
    [getAccessToken]
  );

  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        setData(await request("GET", signal));
      } catch (err) {
        if (err.name === "AbortError") return;
        setError(err.message || "Couldn't load your progress.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [request]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** Permanently deletes this user's stored attempts, then reloads. */
  const deleteAll = async () => {
    setDeleting(true);
    setError(null);
    try {
      const result = await request("DELETE");
      setNotice(`Deleted ${result.deleted} saved attempt${result.deleted === 1 ? "" : "s"}.`);
      setConfirmDelete(false);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't delete your data.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) {
    return (
      <div role="status" aria-label="Loading your progress">
        <div className="stat-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="stat-card skeleton" style={{ height: 92 }} />
          ))}
        </div>
        <div className="card skeleton" style={{ height: 260 }} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="card" role="alert">
        <p className="card-label">Couldn't load your progress</p>
        <p style={{ margin: "0 0 16px" }}>{error}</p>
        <button className="primary-btn" style={{ width: "auto", padding: "10px 20px" }} onClick={() => load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;
  const empty = data.sessions === 0;

  return (
    <div>
      <div className="dash-toolbar">
        <div>
          <h2 style={{ margin: 0 }}>My progress</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>Only you and your team managers can see these results.</p>
        </div>
        <button className="ghost-btn" onClick={() => load()} disabled={loading} aria-label="Refresh data">
          <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="error warn-banner" role="status">
          {notice}
        </div>
      )}

      <div className="stat-grid">
        <StatCard icon={TrendingUp} label="Average score" value={empty ? "—" : data.average_score} hint="across all sessions" />
        <StatCard icon={Award} label="Best score" value={empty ? "—" : data.best_score} hint="your personal best" />
        <StatCard icon={CalendarCheck} label="Sessions" value={data.sessions} hint="completed" />
        <StatCard
          icon={Flame}
          tone={data.streak_days > 0 ? "tone-warn" : undefined}
          label="Practice streak"
          value={`${data.streak_days} day${data.streak_days === 1 ? "" : "s"}`}
          hint={data.streak_days > 0 ? "keep it going!" : "practice today to start one"}
        />
      </div>

      {empty ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ margin: 0 }}>No saved attempts yet. Record a sentence on the Practice tab and it will show up here.</p>
        </div>
      ) : (
        <>
          <section className="card" aria-labelledby="my-trend-title">
            <p className="card-label" id="my-trend-title">
              <span>Your average score, last 30 days</span>
            </p>
            <TrendChart points={data.trend} days={30} />
          </section>

          <section className="card" aria-labelledby="my-attempts-title">
            <p className="card-label" id="my-attempts-title">
              <span>Recent attempts</span>
              <span>latest {data.attempts.length}</span>
            </p>
            <ul className="attempts">
              {data.attempts.map((a) => (
                <li key={a.id}>
                  <div className="attempt-head">
                    <span className="attempt-line" style={{ margin: 0 }}>
                      <strong>Target:</strong> {a.expected_text}
                    </span>
                    <span className="attempt-score" style={{ color: scoreColor(a.score) }}>
                      {a.score}
                    </span>
                  </div>
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

      {/* Privacy controls */}
      <section className="card" aria-labelledby="privacy-title">
        <p className="card-label" id="privacy-title">
          <span>Privacy</span>
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          Echo English saves your email and the text of each practice attempt so you and your managers can follow progress.
          Your audio is sent to our AI provider to be transcribed and is not stored by Echo English.
        </p>
        {confirmDelete ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span>Delete all your saved attempts? This can't be undone.</span>
            <button className="ghost-btn" style={{ borderColor: "var(--bad)", color: "#fca5a5" }} onClick={deleteAll} disabled={deleting}>
              <Trash2 size={16} /> {deleting ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button className="ghost-btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="ghost-btn" onClick={() => setConfirmDelete(true)} disabled={empty}>
            <Trash2 size={16} /> Delete my saved attempts
          </button>
        )}
      </section>
    </div>
  );
}
