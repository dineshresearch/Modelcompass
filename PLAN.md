# Model Compass — PoC Implementation Plan

Multi-model comparison playground for the DigitalOcean staff ML take-home.
Full user journey: prompt → parallel inference → side-by-side answers → metrics → judge synthesis → routing recommendation → preference → export.

## Stack

- Frontend: Vite + React (single-page prototype; stands in for Next.js in the target architecture)
- Backend: FastAPI orchestration service (async httpx, SSE streaming)
- Storage: SQLite (stdlib sqlite3) — experiments, per-model runs, settings
- Endpoint: `https://inference.do-ai.run/v1` (DigitalOcean Serverless Inference, OpenAI-compatible)
- Models (verified 200 with the project key; OpenAI/Anthropic entries are 403 tier-blocked):
  - `deepseek-v4.1-flash`, `glm-5.3-flash` (default judge), `minimax-m2.5`, `kimi-k2.6`

## Phase 1 — Backend core (live-only)

- [x] `config.py`: env-based settings; API key only in backend `.env`; no demo mode
- [x] `catalog.py`: 4 verified models + illustrative per-token pricing (labeled as estimates)
- [x] `providers.py`: live OpenAI-compatible call (httpx `trust_env=False`, per-model timeout, empty-content guard for reasoning models)
- [x] `orchestrator.py`: `asyncio.as_completed` over 2–4 models, semaphore(4), errors isolated per model
- [x] `POST /api/compare` (SSE): `run` per model → `synthesis` → `recommendation` → `done`
- [x] Cost controls: max_tokens default 2048 / cap 2048 (judge 4096), prompt cap 8000 chars, 60s timeout

## Phase 2 — Comparison & evaluation engine

- [x] Metrics per run: latency_ms, tokens in/out (API usage; ~4 chars/token fallback flagged `tokens_estimated`), est. cost
- [x] `synthesis.py`: LLM-as-judge → strict JSON {agreements, differences, weaknesses, uncertainty_notes, overall_confidence, scores}; originals never merged
- [x] Heuristic fallback synthesis if judge fails; judge latency/cost tracked separately
- [x] Judge reliability: scores-first schema, compact output rules, 8192-token budget, truncated-JSON repair, one compact retry, honest fallback labeling + UI warnings (verified: "explain about llm" previously lost scores to truncation; now scores on first attempt)
- [x] `recommend.py`: composite = 0.5·quality + 0.3·cost-eff + 0.2·latency-eff; adaptive escalation below quality threshold; explicit reasons (SLO / cost rank / judge score)

## Phase 3 — Persistence, preference, export

- [x] `store.py`: SQLite `experiments` (+recommendation column), `runs`, `settings`; preference (model + reason) on experiment
- [x] `GET/PUT /api/settings`, `GET /api/experiments`, `GET /api/experiments/{id}`, `POST .../preference`, `POST .../recommend` (recompute)
- [x] `GET /api/experiments/{id}/export?format=json|md` (includes recommendation + preference)
- [x] `GET /api/stats`, `GET /api/health`, `GET /api/models`, `POST /api/test-connection`

## Phase 4 — Frontend (light UI matching the provided mock)

- [x] Topbar (compass logo, ⌘K search, Run Comparison) + left nav: Dashboard / Compare / Evaluate / Recommend / History / Settings
- [x] Dashboard: prompt card + model chips, gradient Recommended card, preview cards (quality bar, Best Fit badge), SVG tradeoffs chart, Why card, status bar (escalation toggle, confidence pill)
- [x] Compare: full unaltered markdown outputs, isolated errors, performance table
- [x] Evaluate: synthesis panel + scores table + preference (pick/reason/save) + export buttons
- [x] Recommend: per-model composite table + routing policy (SLO, threshold, escalation) with live recompute
- [x] History + Settings views; Vite proxy `/api` → `127.0.0.1:8000` (host pinned 127.0.0.1)

## Phase 5 — Verify & hand off

- [x] Key verification server-side: auth OK (78 models); OpenAI trio 403 tier-blocked → user chose the 4 working models
- [x] Live browser run: 4/4 ok, judge scores 88/85/78/91, Balanced Routing → DeepSeek; escalation test (threshold 90 → Quality Escalation → Kimi); preference saved + persisted; exports verified; test-connection OK; all six views render
- [x] `npm run build` passes; structure verified via snapshots + computed-style audit (pixel screenshot pending visible browser panel)
- [x] README + PLAN updated for live-only redesign

## Risks (red-team) & mitigations

| Sev | Risk | Mitigation |
|-----|------|------------|
| High | Model entitlements differ per tier (OpenAI/Anthropic 403) | Catalog limited to verified-200 models; test-connection probe; tier findings documented |
| High | Synthesis merges answers / hallucinates agreement | JSON-only judge contract, preserve originals, explicit uncertainty + confidence; heuristic fallback |
| Med | Reasoning models return empty content at small budgets | 2048 default / 8192 judge; empty-content guard with hint |
| Med | Reasoning judge truncates its JSON → no quality scores | Scores-first schema + compact rules + JSON repair + one retry; labeled fallback with UI warning |
| Med | Token usage absent from API response | Heuristic estimate flagged `tokens_estimated=true`; cost labeled estimate |
| Med | Pricing unknown | Illustrative table, clearly labeled, swap for Model Catalog rates |
| Med | One slow model blocks the comparison | Per-model timeout + SSE emits each result as completed |
| Low | SQLite write contention | Single-writer lock; fine for PoC scale |