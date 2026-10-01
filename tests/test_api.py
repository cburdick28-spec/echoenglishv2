"""API tests. All external services (AI provider, Supabase) are mocked."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

import index
from conftest import AUDIO, auth

NOW = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
RESULT = index.AnalysisResult(score=82, feedback="Nice work", tip="Keep going")
CLEAN = index.Transcription("hello there", False, False, None)


def mock_ai(transcription=CLEAN, result=RESULT):
    return (
        patch.object(index, "transcribe_audio", AsyncMock(return_value=transcription)),
        patch.object(index, "evaluate_pronunciation", AsyncMock(return_value=result)),
    )


def row(i, email, score, days_ago=0, **extra):
    stamp = (NOW - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")
    return {"id": f"id{i}", "user_email": email, "expected_text": "e", "actual_text": "a",
            "score": score, "created_at": stamp, **extra}


# ----------------------------- authentication ------------------------------ #

def test_health_is_public(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_missing_and_invalid_tokens_are_rejected(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=auth("nope")).status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Basic abc"}).status_code == 401


def test_me_reports_manager_flag_and_lowercases_email(client):
    assert client.get("/api/me", headers=auth("emp")).json() == {"email": "emp@corp.com", "is_manager": False}
    assert client.get("/api/me", headers=auth("boss")).json()["is_manager"] is True


# -------------------------------- analyze ---------------------------------- #

def test_analyze_requires_login(client):
    assert client.post("/api/analyze", files=AUDIO, data={"expected_text": "hi"}).status_code == 401


def test_analyze_rejects_spoofed_email(client):
    p1, p2 = mock_ai()
    with p1, p2:
        r = client.post("/api/analyze", files=AUDIO, headers=auth("emp"),
                        data={"expected_text": "hi", "user_email": "boss@corp.com"})
    assert r.status_code == 403


def test_analyze_saves_verified_email(client, fake_supabase):
    p1, p2 = mock_ai()
    with p1, p2:
        r = client.post("/api/analyze", files=AUDIO, headers=auth("emp"),
                        data={"expected_text": "hello there", "user_email": "EMP@corp.com"})
    assert r.status_code == 200 and r.json()["saved"] is True
    assert fake_supabase.inserted == [
        {"user_email": "emp@corp.com", "expected_text": "hello there", "actual_text": "hello there", "score": 82}
    ]


def test_analyze_returns_feedback_even_if_database_fails(client):
    p1, p2 = mock_ai()
    with p1, p2, patch.object(index, "_insert_score", side_effect=RuntimeError("db down")):
        r = client.post("/api/analyze", files=AUDIO, headers=auth("emp"), data={"expected_text": "hi"})
    assert r.status_code == 200
    assert r.json()["saved"] is False and r.json()["score"] == 82


def test_noisy_attempts_are_not_saved(client, fake_supabase):
    p1, p2 = mock_ai(index.Transcription("hello", False, True, None))
    with p1, p2:
        r = client.post("/api/analyze", files=AUDIO, headers=auth("emp"), data={"expected_text": "hi"})
    assert r.json()["low_confidence"] is True and r.json()["saved"] is False
    assert fake_supabase.inserted == []


def test_silence_scores_zero_and_is_not_saved(client, fake_supabase):
    with patch.object(index, "transcribe_audio", AsyncMock(return_value=index.Transcription("", True, True, None))):
        r = client.post("/api/analyze", files=AUDIO, headers=auth("emp"), data={"expected_text": "a b"})
    assert r.json()["score"] == 0 and fake_supabase.inserted == []


def test_input_validation(client):
    big = {"audio": ("r.webm", b"x" * (5 * 1024 * 1024), "audio/webm")}
    empty = {"audio": ("r.webm", b"", "audio/webm")}
    assert client.post("/api/analyze", files=big, headers=auth("emp"), data={"expected_text": "hi"}).status_code == 413
    assert client.post("/api/analyze", files=empty, headers=auth("emp"), data={"expected_text": "hi"}).status_code == 400
    assert client.post("/api/analyze", files=AUDIO, headers=auth("emp"), data={"expected_text": "  "}).status_code == 400


def test_rate_limit_is_per_user(client):
    p1, p2 = mock_ai()
    with p1, p2:
        for _ in range(index.RATE_LIMIT_MAX_REQUESTS):
            assert client.post("/api/analyze", files=AUDIO, headers=auth("emp"), data={"expected_text": "hi"}).status_code == 200
        assert client.post("/api/analyze", files=AUDIO, headers=auth("emp"), data={"expected_text": "hi"}).status_code == 429
        assert client.post("/api/analyze", files=AUDIO, headers=auth("emp2"), data={"expected_text": "hi"}).status_code == 200


# -------------------------------- fluency ---------------------------------- #

def words(*pairs):
    return [NS(word="w", start=s, end=e) for s, e in pairs]


def test_fluency_natural_pace_no_pauses():
    # 6 words over 2.4s = 150 wpm
    ws = words((0, 0.3), (0.4, 0.7), (0.8, 1.1), (1.2, 1.5), (1.6, 1.9), (2.0, 2.4))
    f = index.compute_fluency(ws, [], "a b c d e f")
    assert f.words_per_minute == 150 and f.pace_label == "natural" and f.pause_count == 0


def test_fluency_detects_pauses_and_slow_pace():
    ws = words((0, 0.4), (2.0, 2.4), (2.5, 2.9), (5.0, 5.4))
    f = index.compute_fluency(ws, [], "a b c d")
    assert f.pause_count == 2 and f.longest_pause_seconds == 2.1 and f.pace_label == "slow"


def test_fluency_falls_back_to_segments_and_handles_too_little_speech():
    segs = [NS(start=0.0, end=1.5), NS(start=2.5, end=4.0)]
    f = index.compute_fluency([], segs, "one two three four five six")
    assert f is not None and f.pause_count == 1
    assert index.compute_fluency([], [], "hi there") is None


def test_transcribe_retries_without_word_timestamps():
    from openai import BadRequestError
    import httpx
    err = BadRequestError("nope", response=httpx.Response(400, request=httpx.Request("POST", "http://x")), body=None)
    ok = NS(text="hello", segments=[], words=[])
    client = MagicMock()
    client.audio.transcriptions.create = AsyncMock(side_effect=[err, ok])
    import asyncio
    result = asyncio.run(index.transcribe_audio(client, b"x", "webm"))
    assert result.text == "hello"
    calls = client.audio.transcriptions.create.call_args_list
    assert "timestamp_granularities" in calls[0].kwargs and "timestamp_granularities" not in calls[1].kwargs


# ------------------------------- dashboard --------------------------------- #

def test_dashboard_is_manager_only(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/dashboard", headers=auth("emp")).status_code == 403
    assert client.get("/api/dashboard/export", headers=auth("emp")).status_code == 403


def test_build_dashboard_metrics():
    rows = [row(1, "A@x.com", 90), row(2, "b@x.com", 50), row(3, "a@x.com", 80, 1),
            row(4, "b@x.com", 60, 2), row(5, "c@x.com", 75, 40),
            {"id": "bad", "user_email": "z@x.com", "score": None, "created_at": "nope"}]
    d = index.build_dashboard(rows, total=6, now=NOW)
    assert (d.total_sessions, d.average_score, d.active_employees, d.needs_coaching_count) == (6, 71.0, 3, 1)
    assert d.employees[0].email == "b@x.com" and d.employees[0].needs_coaching
    assert [t.date for t in d.trend] == ["2026-09-29", "2026-09-30", "2026-10-01"]


def test_build_dashboard_empty():
    d = index.build_dashboard([], 0, NOW)
    assert d.average_score == 0.0 and d.employees == [] and d.truncated is False


def test_dashboard_endpoint_and_db_error(client):
    with patch.object(index, "_fetch_score_rows", return_value=([row(1, "a@x.com", 90)], 1)):
        r = client.get("/api/dashboard", headers=auth("boss"))
    assert r.status_code == 200 and r.json()["total_sessions"] == 1
    with patch.object(index, "_fetch_score_rows", side_effect=RuntimeError("x")):
        assert client.get("/api/dashboard", headers=auth("boss")).status_code == 502


def test_fetch_pages_through_all_rows():
    calls = []

    class Query:
        def select(self, *a, **k): return self
        def order(self, *a, **k): return self
        def range(self, a, b): calls.append((a, b)); self.r = (a, b); return self
        def execute(self): return NS(data=[{}] * (self.r[1] - self.r[0] + 1), count=9999)

    sb = MagicMock(); sb.table.return_value = Query()
    index._supabase = sb
    rows, total = index._fetch_score_rows()
    assert len(rows) == index.MAX_DASHBOARD_ROWS and total == 9999 and calls[0] == (0, 999)


def test_csv_export_neutralises_formulas(client):
    evil = row(1, "a@x.com", 70, actual_text="=HYPERLINK(\"http://evil\")", expected_text="+cmd")
    with patch.object(index, "_fetch_score_rows", return_value=([evil], 1)):
        r = client.get("/api/dashboard/export", headers=auth("boss"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert "'=HYPERLINK" in r.text and "'+cmd" in r.text
    assert r.text.splitlines()[0] == "created_at,user_email,score,expected_text,actual_text"


# -------------------------------- history ---------------------------------- #

def test_history_requires_login(client):
    assert client.get("/api/history").status_code == 401
    assert client.delete("/api/history").status_code == 401


def test_build_history_stats_and_streak():
    rows = [row(1, "e@x.com", 90, 0), row(2, "e@x.com", 70, 1), row(3, "e@x.com", 60, 2), row(4, "e@x.com", 80, 5)]
    h = index.build_history(rows, 4, "e@x.com", NOW)
    assert (h.sessions, h.average_score, h.best_score, h.latest_score, h.streak_days) == (4, 75.0, 90, 90, 3)
    assert len(h.attempts) == 4


def test_streak_counts_from_yesterday_and_breaks_on_gaps():
    today = NOW.date()
    assert index.compute_streak({today - timedelta(days=1), today - timedelta(days=2)}, today) == 2
    assert index.compute_streak({today - timedelta(days=2)}, today) == 0
    assert index.compute_streak(set(), today) == 0


def test_history_endpoint_only_queries_own_email(client):
    with patch.object(index, "_fetch_user_rows", return_value=([row(1, "emp@corp.com", 88)], 1)) as fetch:
        r = client.get("/api/history", headers=auth("emp"))
    fetch.assert_called_once_with("emp@corp.com")
    assert r.status_code == 200 and r.json()["best_score"] == 88


def test_delete_history_only_deletes_own_rows(client):
    with patch.object(index, "_delete_user_rows", return_value=3) as delete:
        r = client.delete("/api/history", headers=auth("emp"))
    delete.assert_called_once_with("emp@corp.com")
    assert r.json() == {"deleted": 3}
