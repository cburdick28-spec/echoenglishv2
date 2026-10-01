"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Practice sentences, roughly ordered from easy to tricky. */
const PRACTICE_SENTENCES = [
  "The weather is beautiful today, so we decided to walk to the park.",
  "She sells seashells by the seashore every summer morning.",
  "Could you please tell me where the nearest train station is?",
  "Thirty-three thoughtful thinkers thought through the thorough theory.",
  "I would rather have a quiet evening at home than go to the party.",
  "The three brothers thoroughly enjoyed their international vacation.",
  "Please write down the right answer before the clock strikes eight.",
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

/* -------------------------------------------------------------------------- */
/* Components                                                                 */
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

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Home() {
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

  /** Uploads the recording to the FastAPI backend and stores the analysis. */
  const analyze = useCallback(
    async (blob) => {
      setStatus("analyzing");
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const extension = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
        const formData = new FormData();
        formData.append("audio", blob, `recording.${extension}`);
        formData.append("expected_text", sentence);

        const response = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        const data = await response.json().catch(() => null);
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
    [sentence]
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    idle: "Tap the microphone and read the sentence aloud",
    recording: "Recording… tap again when you're done",
    analyzing: "",
    done: "Here's how you did",
  }[status];

  return (
    <main className="page">
      <header className="header">
        <div className="logo">
          <span className="logo-mark" aria-hidden="true">🎙️</span>
          Echo English
        </div>
        <p className="tagline">AI feedback on your pronunciation, in seconds.</p>
      </header>

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

      <p className="footer">Built with Next.js, FastAPI, Whisper &amp; GPT-4o mini</p>
    </main>
  );
}
