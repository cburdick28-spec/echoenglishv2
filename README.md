# 🎙️ Echo English

**An AI-powered English pronunciation and fluency coach.** Read a sentence aloud, and Echo English transcribes your speech, scores it out of 100, highlights the words you missed or mispronounced, and gives you a practice tip.

## How it works

1. The browser records your voice with the **MediaRecorder API**.
2. The audio is sent as `multipart/form-data` to a **FastAPI** endpoint (`POST /api/analyze`) running as a Vercel Serverless Function.
3. A **Whisper** model transcribes the audio.
4. A chat model compares the transcript with the target sentence and returns structured JSON: score, missed words, mispronounced words, feedback and a tip.
5. The backend validates the JSON with **Pydantic**, and the **Next.js** UI renders the results.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js (App Router), React, plain CSS |
| Backend | Python, FastAPI, Pydantic |
| AI | OpenAI Python SDK, Whisper speech-to-text, LLM evaluation |
| Hosting | Vercel (Next.js + Python Serverless Functions) |

The backend supports two interchangeable AI providers through the same SDK:

| Provider | Environment variable | Models |
| --- | --- | --- |
| Groq (free tier) | `GROQ_API_KEY` | `whisper-large-v3-turbo`, `llama-3.3-70b-versatile` |
| OpenAI | `OPENAI_API_KEY` | `whisper-1`, `gpt-4o-mini` |

If `GROQ_API_KEY` is set it takes priority.

## Project structure

```
echo-english/
├── api/
│   └── index.py          # FastAPI backend
├── src/app/
│   ├── page.js           # Recorder UI and results display
│   ├── layout.js         # Root layout and metadata
│   └── globals.css       # Styles
├── requirements.txt      # Python dependencies
├── package.json          # Frontend dependencies
└── vercel.json           # Routes /api/* to the Python function
```

## Running locally

Prerequisites: Node.js 18+, Python 3.11+, and the [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`).

```bash
npm install
echo "GROQ_API_KEY=your-key-here" > .env   # or OPENAI_API_KEY=...
vercel dev
```

Open http://localhost:3000. Use `vercel dev` rather than `next dev` so the Python API runs too. Browsers only allow microphone access on `localhost` or HTTPS.

## Deploying

1. Import this repo into [Vercel](https://vercel.com/new).
2. Add `GROQ_API_KEY` (or `OPENAI_API_KEY`) under **Settings → Environment Variables**.
3. Redeploy. Vercel builds the frontend and the Python function automatically.

## API

`POST /api/analyze` (multipart/form-data)

| Field | Type | Description |
| --- | --- | --- |
| `audio` | file | Recording (webm, mp4, ogg, wav; max 4 MB) |
| `expected_text` | string | The sentence the learner was asked to read |

Example response:

```json
{
  "score": 82,
  "missed_words": ["park"],
  "mispronounced_words": [
    { "expected": "weather", "heard": "whether", "advice": "Start with a soft 'w' and finish with the 'th' in 'the'." }
  ],
  "feedback": "Nice work! Most of the sentence was clear.",
  "tip": "Practice the 'th' sound by placing your tongue lightly between your teeth.",
  "transcript": "the whether is beautiful today"
}
```

`GET /api/health` returns `{"status": "ok"}`.

## Design notes

- **Whisper is not primed with the target sentence.** Doing so would bias it toward "correcting" mistakes and hide the errors the app exists to catch.
- **Upload limits:** Vercel rejects request bodies over about 4.5 MB, so recordings are capped at 30 seconds and 4 MB, with friendly errors.
- **Robust output:** the LLM runs in JSON mode and its response is validated with Pydantic before reaching the UI.
- **Cross-browser audio:** the recorder picks webm or mp4 based on browser support, so Safari works too.

## Possible next steps

- Progress tracking across sessions
- Phoneme-level feedback
- More sentence difficulty levels and custom text
