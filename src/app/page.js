"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { LayoutDashboard, LogOut, Mail, Mic } from "lucide-react";
import Dashboard from "./dashboard";

/* -------------------------------------------------------------------------- */
/* Supabase (browser) client                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The anon key is designed to be public: it can only do what Row Level Security allows,
 * and our `scores` table has no public policies. All data access goes through the
 * FastAPI backend, which verifies the user's token first.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Corporate practice phrases, roughly ordered from easy to tricky. */
const PRACTICE_SENTENCES = [
  "Thank you for joining the call, let's begin with a quick review of the agenda.",
  "I would like to schedule a follow-up meeting to discuss the quarterly results.",
  "Could you please send me the updated proposal before the end of the day?",
  "Our team is committed to delivering exceptional value to every client.",
  "Let's schedule a meeting to review the budget and align on our priorities.",
  "We anticipate a significant increase in revenue throughout the third quarter.",
  "Please let me know if there are any concerns regarding the project timeline.",
  "The strategic partnership will strengthen our competitive position in international markets.",
];

/** Hard cap on recording length. Keeps uploads under Vercel's ~4.5 MB body limit. */
const MAX_RECORDING_SECONDS = 30;

/** Preferred MediaRecorder formats, in order. Safari only supports mp4. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Returns the first MIME type this browser's MediaRecorder supports (or ""). */
function pickSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/** Lowercases a word and strips punctuation so it can be compared with AI output. */
function normalizeWord(word) {
  return word.toLowerCase().replace(/[^a-z0-9'-]/g, "");
}

/** Turns a raw getUserMedia error into a friendly message. */
function describeMicError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was blocked. Allow it in your browser's address bar and try again.";
    case "NotFoundError":
      return "No microphone was found. Please connect one and try again.";
    case "NotReadableError":
      return "Your microphone is being used by another application.";
    default:
      return "Couldn't start recording. Please check your microphone and try again.";
  }
}

/** Score → colour used by the ring and number. */
function scoreColor(score) {
  if (score >= 85) return "var(--good)";
  if (score >= 60) return "var(--warn)";
  return "var(--bad)";
}

/** Score → short headline. */
function scoreLabel(score) {
  if (score >= 90) return "Excellent!";
  if (score >= 75) return "Great job";
  if (score >= 60) return "Good effort";
  return "Keep practicing";
}

/** Very light email sanity check; the real validation happens in Supabase. */
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* -------------------------------------------------------------------------- */
/* Small components                                                           */
/* -------------------------------------------------------------------------- */

/** Circular score gauge drawn with SVG. */
function ScoreRing({ score }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = scoreColor(score);

  return (
    <div className="score-ring" role="img" aria-label={`Score: ${score} out of 100`}>
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={radius} fill="none" stroke="#334155" strokeWidth="12" />
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="score-value" style={{ color }}>
        <span>
          {score}
          <small>/ 100</small>
        </span>
      </div>
    </div>
  );
}

/** Renders the prompt sentence, highlighting words flagged by the AI. */
function HighlightedSentence({ sentence, result }) {
  const { missed, mispronounced } = useMemo(() => {
    if (!result) return { missed: new Set(), mispronounced: new Set() };
    return {
      missed: new Set(result.missed_words.map(normalizeWord)),
      mispronounced: new Set(result.mispronounced_words.map((w) => normalizeWord(w.expected))),
    };
  }, [result]);

  return (
    <p className="sentence">
      {sentence.split(/\s+/).map((word, index) => {
        const key = normalizeWord(word);
        let className = "word word-ok";
        if (missed.has(key)) className = "word word-missed";
        else if (mispronounced.has(key)) className = "word word-mispronounced";
        return (
          <span key={`${word}-${index}`}>
            <span className={className}>{word}</span>{" "}
          </span>
        );
      })}
    </p>
  );
}

/** Brand header shared by every screen. */
function Header({ tagline }) {
  return (
    <header className="header">
      <div className="logo">
        <span className="logo-mark" aria-hidden="true">
          <Mic size={24} />
        </span>
        Echo English
      </div>
      {tagline && <p className="tagline">{tagline}</p>}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

/** Passwordless sign-in: Supabase emails the employee a one-time magic link. */
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!looksLikeEmail(cleaned)) {
      setError("Please enter a valid work email address.");
      return;
    }

    setStatus("sending");
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: cleaned,
      options: { emailRedirectTo: window.location.origin },
    });

    if (authError) {
      setError(authError.message || "Couldn't send the sign-in link. Please try again.");
      setStatus("idle");
      return;
    }
    setEmail(cleaned);
    setStatus("sent");
  };

  return (
    <main className="page">
      <Header tagline="Speech and fluency training for your team." />
      <section className="card">
        {status === "sent" ? (
          <div className="login-sent" role="status">
            <div className="login-icon" aria-hidden="true">
              <Mail size={28} />
            </div>
            <h2 style={{ margin: "0 0 8px" }}>Check your inbox</h2>
            <p className="muted" style={{ margin: "0 0 20px" }}>
              We sent a sign-in link to <strong style={{ color: "var(--text)" }}>{email}</strong>. Open it on this device to
              continue.
            </p>
            <button className="link-button" onClick={() => setStatus("idle")}>
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 style={{ margin: "0 0 4px" }}>Sign in</h2>
            <p className="muted" style={{ margin: "0 0 20px" }}>
              Enter your work email and we'll send you a secure sign-in link. No password needed.
            </p>
            <label className="field-label" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              type="email"
              className="text-input"
              placeholder="you@company.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "sending"}
              required
            />
            {error && (
              <div className="error" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>
                {error}
              </div>
            )}
            <button className="primary-btn" style={{ marginTop: 16 }} disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

/** Shown when the NEXT_PUBLIC_SUPABASE_* variables are missing at build time. */
function ConfigMissing() {
  return (
    <main className="page">
      <Header />
      <section className="card" role="alert">
        <h2 style={{ marginTop: 0 }}>Setup required</h2>
        <p className="muted">
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your environment
          variables, then redeploy. See the README for the full setup guide.
        </p>
      </section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Practice view (employee)                                                   */
/* -------------------------------------------------------------------------- */

function PracticeView({ email, getAccessToken, onSessionExpired }) {
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | recording | analyzing | done
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const abortRef = useRef(null);

  const sentence = PRACTICE_SENTENCES[sentenceIndex];
  const isRecording = status === "recording";
  const isAnalyzing = status === "analyzing";

  /** Stops the mic stream and the elapsed-time counter. */
  const releaseResources = useCallback(() => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** Clean up on unmount: release the mic, cancel in-flight requests. */
  useEffect(() => {
    return () => {
      releaseResources();
      abortRef.current?.abort();
    };
  }, [releaseResources]);

  /** Revoke the previous object URL whenever a new recording replaces it. */
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  /** Uploads the recording (with the user's access token) and stores the analysis. */
  const analyze = useCallback(
    async (blob) => {
      setStatus("analyzing");
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getAccessToken();
        if (!token) {
          onSessionExpired();
          return;
        }

        const extension = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
        const formData = new FormData();
        formData.append("audio", blob, `recording.${extension}`);
        formData.append("expected_text", sentence);
        // The backend ignores this for identity and verifies it against the token.
        formData.append("user_email", email);

        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal: controller.signal,
        });

        const data = await response.json().catch(() => null);
        if (response.status === 401) {
          onSessionExpired();
          return;
        }
        if (!response.ok) {
          throw new Error(data?.detail || `Request failed (${response.status}).`);
        }

        setResult(data);
        setStatus("done");
      } catch (err) {
        if (err.name === "AbortError") return;
        setError(err.message || "Something went wrong. Please try again.");
        setStatus("idle");
      }
    },
    [sentence, email, getAccessToken, onSessionExpired]
  );

  /** Requests the mic and begins recording. */
  const startRecording = useCallback(async () => {
    setError(null);
    setResult(null);
    setAudioUrl(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Your browser doesn't support audio recording. Try the latest Chrome, Edge, Firefox or Safari.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Ask the browser to clean up the signal; helps a lot in noisy offices.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const mimeType = pickSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        releaseResources();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        // Ignore accidental taps that produced almost no audio.
        if (blob.size < 1000) {
          setError("That recording was too short. Hold on a little longer and read the full sentence.");
          setStatus("idle");
          return;
        }
        setAudioUrl(URL.createObjectURL(blob));
        analyze(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setSeconds(0);
      setStatus("recording");

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_RECORDING_SECONDS) {
            recorder.state === "recording" && recorder.stop();
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      releaseResources();
      setError(describeMicError(err));
      setStatus("idle");
    }
  }, [analyze, releaseResources]);

  /** Stops recording; the recorder's onstop handler takes over from here. */
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  /** Clears results and returns to the idle state. */
  const reset = useCallback(() => {
    setResult(null);
    setAudioUrl(null);
    setError(null);
    setStatus("idle");
  }, []);

  /** Moves to the next practice sentence. */
  const nextSentence = useCallback(() => {
    reset();
    setSentenceIndex((i) => (i + 1) % PRACTICE_SENTENCES.length);
  }, [reset]);

  const statusText = {
    idle: "Tap the microphone and read the sentence aloud (quiet spot works best)",
    recording: "Recording… tap again when you're done",
    analyzing: "",
    done: "Here's how you did",
  }[status];

  return (
    <>
      {/* Prompt */}
      <section className="card" aria-labelledby="prompt-label">
        <p className="card-label" id="prompt-label">
          <span>Read this aloud</span>
          <button className="link-button" onClick={nextSentence} disabled={isRecording || isAnalyzing}>
            New sentence ↻
          </button>
        </p>
        <HighlightedSentence sentence={sentence} result={result} />
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {/* Recorder / loading */}
      <section className="card">
        {isAnalyzing ? (
          <div className="loading" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <span>Analyzing your pronunciation…</span>
          </div>
        ) : (
          <div className="recorder">
            <button
              className={`record-btn ${isRecording ? "recording" : ""}`}
              onClick={isRecording ? stopRecording : startRecording}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? "■" : "🎤"}
            </button>
            <p className="status-text" aria-live="polite">
              {isRecording ? (
                <>
                  <span className="timer">
                    0:{String(seconds).padStart(2, "0")} / 0:{MAX_RECORDING_SECONDS}
                  </span>{" "}
                  · {statusText}
                </>
              ) : (
                statusText
              )}
            </p>
            {audioUrl && <audio controls src={audioUrl} />}
          </div>
        )}
      </section>

      {result && status === "done" && result.low_confidence && (
        <div className="error warn-banner" role="status">
          Background noise may have affected this result, so this attempt was <strong>not</strong> added to your team's
          records. Try again somewhere quieter or hold the microphone closer.
        </div>
      )}
      {result && status === "done" && !result.low_confidence && !result.saved && result.score > 0 && (
        <div className="error warn-banner" role="status">
          Your feedback is ready, but we couldn't save this attempt to your team's records.
        </div>
      )}

      {/* Results */}
      {result && status === "done" && (
        <section className="card" aria-labelledby="results-title">
          <div className="score-row">
            <ScoreRing score={result.score} />
            <div className="feedback">
              <h2 id="results-title" style={{ margin: "0 0 6px" }}>
                {scoreLabel(result.score)}
              </h2>
              <p style={{ margin: 0 }}>{result.feedback}</p>
            </div>
          </div>

          <hr className="divider" />

          <h3 className="section-title">What we heard</h3>
          <p className="transcript">“{result.transcript || "—"}”</p>

          {result.missed_words.length > 0 && (
            <>
              <hr className="divider" />
              <h3 className="section-title">Missed words</h3>
              <div className="chips">
                {result.missed_words.map((word, i) => (
                  <span key={`${word}-${i}`} className="chip chip-missed">
                    {word}
                  </span>
                ))}
              </div>
            </>
          )}

          {result.mispronounced_words.length > 0 && (
            <>
              <hr className="divider" />
              <h3 className="section-title">Mispronounced</h3>
              <ul className="word-list">
                {result.mispronounced_words.map((item, i) => (
                  <li key={`${item.expected}-${i}`}>
                    <span className="chip chip-warn">{item.expected}</span>
                    heard as “{item.heard}”
                    {item.advice && <span className="advice">{item.advice}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <hr className="divider" />
          <h3 className="section-title">Practice tip</h3>
          <p className="tip">{result.tip}</p>

          <hr className="divider" />
          <button className="primary-btn" onClick={reset}>
            Try again
          </button>
          <button
            className="primary-btn"
            style={{ background: "transparent", border: "1px solid var(--card-border)" }}
            onClick={nextSentence}
          >
            Next sentence →
          </button>
        </section>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Home() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [tab, setTab] = useState("practice"); // practice | dashboard

  /** Restore any saved session, then keep in sync with sign-in / sign-out / token refresh. */
  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => subscription.unsubscribe();
  }, []);

  /** Always read the freshest token (supabase-js refreshes it automatically). */
  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setIsManager(false);
    setTab("practice");
  }, []);

  /** Ask the backend whether this verified user is a manager (controls the Dashboard tab). */
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) {
      setIsManager(false);
      return undefined;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        setIsManager(Boolean(response.ok && body?.is_manager));
      } catch {
        setIsManager(false); // fail closed: hide the dashboard if we can't confirm
      }
    })();
    return () => controller.abort();
  }, [userId, getAccessToken]);

  if (!supabase) return <ConfigMissing />;

  if (!authReady) {
    return (
      <main className="page">
        <Header />
        <div className="loading" role="status">
          <div className="spinner" aria-hidden="true" />
        </div>
      </main>
    );
  }

  if (!session) return <LoginScreen />;

  const email = session.user.email;

  return (
    <main className={`page ${tab === "dashboard" ? "page-wide" : ""}`}>
      <Header tagline="AI feedback on your pronunciation, in seconds." />

      <div className="userbar">
        <span className="userbar-email" title={email}>
          {email}
        </span>
        <button className="ghost-btn" onClick={signOut}>
          <LogOut size={16} /> Sign out
        </button>
      </div>

      {isManager && (
        <nav className="tabs" aria-label="Views">
          <button className={`tab ${tab === "practice" ? "active" : ""}`} onClick={() => setTab("practice")}>
            <Mic size={16} /> Practice
          </button>
          <button className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
            <LayoutDashboard size={16} /> Team dashboard
          </button>
        </nav>
      )}

      {tab === "dashboard" && isManager ? (
        <Dashboard getAccessToken={getAccessToken} />
      ) : (
        <PracticeView email={email} getAccessToken={getAccessToken} onSessionExpired={signOut} />
      )}

      <p className="footer">Built with Next.js, FastAPI, Supabase &amp; Whisper</p>
    </main>
  );
}
