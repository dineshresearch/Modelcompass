# Model Compass

A multi-model comparison playground — PoC for the DigitalOcean staff ML take-home.
It demonstrates the **complete user journey**, not just an API that calls several models:

> prompt → parallel inference → side-by-side answers → performance metrics → judge synthesis (with explicit uncertainty) → routing recommendation → user preference → export

Built **live-only** against DigitalOcean Serverless Inference (`https://inference.do-ai.run/v1`, OpenAI-compatible). Four models verified working with the project key (HTTP 200 on `chat/completions`):

| Model ID | Label | Role |
|---|---|---|
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | fast reasoning |
| `glm-5.3-flash` | GLM 5.3 Flash | low-latency; default synthesis judge |
| `minimax-m2.5` | MiniMax M2.5 | general-purpose reasoning |
| `kimi-k2.6` | Kimi K2.6 | long-context chat |

**Key/tier findings (verified server-side):** the API key authenticates (`GET /v1/models` → 200, 78 models). OpenAI/Anthropic catalog entries (e.g. `openai-gpt-5-nano`, `openai-gpt-6-sol`, `openai-gpt-6-luna`) return **403 "not available for your subscription tier"** on this key's plan, so the catalog uses the four working models above.

## Quickstart (live — API key required)

```bash
# 1. Backend (FastAPI, port 8000)
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux
cp .env.example .env        # then put your key in INFERENCE_API_KEY (file only)
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. Frontend (Vite + React, port 5173)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — the sample prompt is prefilled and all four models are selected; click **Compare Models**.

The API key lives only in `backend/.env` (gitignored). The frontend never sees it; Settings shows "configured (backend/.env)" and a **Test connection** probe.

## The journey (six views)

- **Dashboard** — prompt + model chips, light-blue "Recommended" routing card, side-by-side preview cards (quality score, latency, cost; blue-bordered **Best Fit**), grouped-bar **Model Tradeoffs** chart, "Why this recommendation?" reasons, status bar (adaptive-escalation toggle, evaluation confidence).
- **Compare** — full, unaltered markdown outputs with isolated per-model errors; performance table (status, latency, tokens in/out, est. cost, wall clock, total incl. judge).
- **Evaluate** — judge synthesis as a separate labeled artifact (agreements / attributed differences / weaknesses with confidence / uncertainty notes), judge quality scores with rationales, and **your preference** (pick + reason, persisted) with JSON/Markdown export.
- **Recommend** — composite scoring per model, routing policy controls (latency SLO, quality threshold, adaptive escalation). Changes recompute the current experiment and apply to future runs.
- **History** — every experiment with best fit, strategy, preference, cost; open / export JSON / export MD.
- **Settings** — endpoint, key status, timeout, judge model, default max tokens, synthesis toggle.

## Architecture

```
React (Vite) frontend ── /api proxy ──▶ FastAPI orchestration service
  6 views · SSE consumer                   auth boundary (key server-side)
  preview/full cards · metrics             bounded concurrency (4) · per-model timeouts
  synthesis · preference · export          cost controls (token/prompt caps)
        │                                        │
        │ SSE: run → synthesis →                 ├──▶ inference.do-ai.run (×N parallel)
        │      recommendation → done             ├──▶ judge (1 extra call) + recommendation engine
        └────────────────────────────────────────┴──▶ SQLite: experiments · runs · settings
```

Mapping to DigitalOcean's existing surface (build on, don't duplicate):

| PoC component | DO product it extends |
|---|---|
| `catalog.py` model list + pricing | Model Catalog |
| Playground-style comparison UI | Model Playground |
| `providers.py` OpenAI-compatible calls | Serverless Inference |
| Synthesis judge + preference capture | Evaluations (preference data flywheel) |
| Recommendation engine / adaptive escalation | Inference Router |

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` · `GET /api/models` | Key status, catalog, pricing note |
| `GET /api/settings` · `PUT /api/settings` | Run defaults + routing policy |
| `POST /api/compare` | SSE: `run` per model (as completed) → `synthesis` → `recommendation` → `done` |
| `POST /api/test-connection` | Live key probe via the judge model |
| `GET /api/experiments` · `GET /api/experiments/{id}` | History |
| `POST /api/experiments/{id}/preference` | Preferred model + reason |
| `POST /api/experiments/{id}/recommend` | Recompute recommendation with current settings |
| `GET /api/experiments/{id}/export?format=json\|md` | Download |
| `GET /api/stats` | Per-model latency/cost/error aggregates, preference wins |

## Key design decisions

- **Synthesis never merges answers.** The judge produces a separate, labeled JSON artifact (agreements, attributed differences, weaknesses with confidence, uncertainty notes, per-model quality scores). Originals are stored and displayed unaltered. If the judge fails or returns invalid JSON, a deterministic heuristic fallback (lexical overlap) is shown — clearly marked as non-semantic, with an amber warning and no fabricated scores.
- **Judge reliability.** Quality scores come from an LLM-as-judge (default `glm-5.3-flash`, configurable). Reasoning judges can truncate their JSON at the token cap, so the pipeline uses a scores-first schema, compact output rules, an 8192-token judge budget, best-effort truncated-JSON repair, and one automatic compact retry. Fallbacks are honestly labeled (`fallback: true`, `judge_model: heuristic-fallback`).
- **Recommendation from real metrics.** Composite = `0.5·quality + 0.3·cost-efficiency + 0.2·latency-efficiency` (efficiencies = min/value across the run). **Adaptive escalation** overrides the balanced pick when its judge quality is below the threshold, routing to the highest-quality model that clears it. Reasons are explicit (SLO check, cost rank, judge score) — no fabricated numbers.
- **Error isolation.** Each model runs as its own task with a timeout; a failure becomes an `error` run, never an exception that sinks the comparison. SSE emits each result the moment it completes. If a reasoning model spends its whole token budget thinking and returns empty content, the run **auto-retries once with a doubled budget** (up to the cap) before failing — badged "auto-retried (2× budget)" in the Compare view.
- **Reasoning-model headroom.** These models emit `reasoning_content` before final content; small token budgets return empty answers. Defaults: 4096 max tokens per run (cap 8192), 8192 for the judge, 120s per-model timeout, and an explicit empty-content guard with a hint.
- **Honest metrics.** Token counts come from API `usage`; when absent, a ~4 chars/token estimate is flagged `tokens_estimated` (`*` in the UI). Pricing is an **illustrative placeholder table** — swap in DO Model Catalog rates before any real cost analysis.
- **Preference as evaluation data.** User picks + reasons are persisted per experiment — the seed of a preference dataset (human feedback drives ranking/evals, not just vibes).
- **Cost controls.** Prompt capped at 8000 chars, 2–4 models per run, concurrency semaphore, 120s per-model timeout. The judge is one extra call, tracked separately in totals.

## What is real vs illustrative

| Real (verified live) | Illustrative |
|---|---|
| Parallel inference to all 4 models (4/4 ok) | Pricing table (placeholder $/M rates) |
| Latency, token usage, SSE streaming | — |
| Judge synthesis + quality scores (glm-5.3-flash) | — |
| Recommendation + adaptive escalation (tested: threshold 90 → routes to Kimi) | — |
| Preference persistence, history, JSON/MD exports | — |

**Verification status (2026-11-21):** full live journey verified through the browser UI — comparison (4/4 ok), synthesis with uncertainty, scores, preference saved + persisted, escalation recompute, history, exports, test-connection; all six views render; `npm run build` passes. Pixel screenshot pending (in-app browser panel must be visible); structure verified via accessibility snapshots + computed-style audit.

## Production next steps

1. Source pricing from the DO Model Catalog; per-tier model entitlements from the catalog API.
2. Real auth (DO OAuth / API keys) + per-user rate limits and budget guards.
3. Streaming token output per card; retries with backoff; circuit breakers.
4. Swap SQLite for Postgres; add OpenTelemetry traces per experiment.
5. Grow the preference dataset into pairwise evals; calibrate the judge against human labels; track judge–human agreement over time.