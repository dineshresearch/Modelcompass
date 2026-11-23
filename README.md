# Model Compass

A multi-model comparison playground — PoC for the DigitalOcean staff ML take-home.
It demonstrates the **complete user journey**, not just an API that calls several models:

> prompt → cost estimate → parallel streaming inference → blind side-by-side answers → performance metrics → judge synthesis (with explicit uncertainty) → routing recommendation → user preference → export

Built **live-only** against DigitalOcean Serverless Inference (`https://inference.do-ai.run/v1`, OpenAI-compatible). Four models verified working with the project key (HTTP 200 on `chat/completions`):

| Model ID | Label | Role | Reasoning off |
|---|---|---|---|
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | fast reasoning | full (`reasoning_effort: none`) |
| `glm-5.3-flash` | GLM 5.3 Flash | low-latency; default synthesis judge | near-full (`reasoning_effort: none`) |
| `minimax-m2.5` | MiniMax M2.5 | general-purpose reasoning | **partial only** (`thinking: disabled`, ~50% reduction) |
| `kimi-k2.6` | Kimi K2.6 | long-context chat | full (`reasoning_effort: none`) |

The reasoning-off knobs were probed live per model; the UI labels MiniMax honestly as a partial reduction rather than claiming a full off switch.

**Key/tier findings (verified server-side):** the API key authenticates (`GET /v1/models` → 200, 78 models). OpenAI/Anthropic catalog entries return **403 "not available for your subscription tier"** on this key's plan, so the catalog uses the four working models above.

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

Open http://localhost:5173 — Fast mode is the default (two cheapest models, no judge, streamed). Click **Compare Models**.

The API key lives only in `backend/.env` (gitignored). The frontend never sees it; Settings shows "configured (backend/.env)" and a **Test connection** probe.

## Run modes

| Mode | Panel | Judge | Delivery |
|---|---|---|---|
| **Fast** (default) | 2 cheapest models | no | SSE token streaming |
| **Balanced** | 3–4 models | lightweight judge | SSE token streaming |
| **Deep** | full panel | judge + synthesis | opt-in **async job** (202 + `job_id`, polling with partial output) |
| Custom | any deviation from a preset | as configured | SSE (or async if requested) |

## The journey (six views)

- **Dashboard** — prompt, run-mode selector, model chips with per-model **R** (reasoning) toggles, global reasoning switch with a trade-off note, **$ cap** input, **Fresh run** (cache bypass), pre-run **worst-case estimate**, **Run cheaper** and **Suggest panel** actions; live streaming previews with cursor; blind Model A–D cards with a **Reveal model names** button; status banner carrying the run envelope (ok / partial / degraded / failed / cancelled) and expandable status notes; tradeoffs chart; "Why this recommendation?" reasons; adaptive-escalation toggle.
- **Compare** — full, unaltered markdown outputs; isolated per-model failure boxes with error kinds (timeout / rate_limited / failed / circuit_open / budget / cancelled); **Retry failed panels** re-runs only the bad panels in place and re-judges when the quorum is met; performance table with cache badges, burned-token costs on failed panels, and totals incl. judge and budget spend.
- **Evaluate** — judge synthesis as a separate labeled artifact (agreements / attributed differences / weaknesses with confidence / uncertainty notes), judge quality scores with rationales, and **your preference** (pick + reason, persisted). Blind mode masks model names even inside the judge's prose until you reveal. JSON/Markdown export.
- **Recommend** — composite scoring per model, routing policy controls (latency SLO, quality threshold, adaptive escalation). Changes recompute the current experiment and apply to future runs.
- **History** — every experiment with run mode, envelope status, best fit, strategy, preference, cost; open / export JSON / export MD.
- **Settings** — endpoint, key status, timeout, judge model, default max tokens, synthesis toggle; **answer cache** (enabled + freshness TTL); **spend guardrails** (daily/monthly caps with usage bars and ok/warn/blocked alerts).

## Architecture

```
React (Vite) frontend ── /api proxy ──▶ FastAPI orchestration service
  6 views · SSE consumer + job poller      auth boundary (key server-side)
  blind reveal · budget UX · badges        bounded concurrency (4) · per-model timeouts
        │                                  circuit breakers · jittered transient retry
        │ SSE: started → panel_started →   cost guard (estimate · reservations · caps)
        │ panel_token → panel_* →          cache (exact + semantic + single-flight)
        │ synthesis → recommendation →     failure envelope · retry-failed · cancel
        │ done (envelope + totals)         ├──▶ inference.do-ai.run (×N parallel, streamed)
        │                                  ├──▶ judge (1 extra call, gated by quorum)
        └── 202 job_id (Deep) ────────────▶┴──▶ SQLite: experiments · runs · cache · settings
```

Mapping to DigitalOcean's existing surface (build on, don't duplicate):

| PoC component | DO product it extends |
|---|---|
| `catalog.py` model list + pricing | Model Catalog |
| Playground-style comparison UI | Model Playground |
| `providers.py` OpenAI-compatible streaming calls | Serverless Inference |
| Synthesis judge + preference capture | Evaluations (preference data flywheel) |
| Recommendation engine / adaptive escalation | Inference Router |

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` · `GET /api/models` | Key status, catalog, pricing note, reasoning-off effects |
| `GET /api/settings` · `PUT /api/settings` | Run defaults, routing policy, cache, spend caps |
| `POST /api/estimate` | Pre-run worst-case cost (panels + judge), before anything is invoked |
| `POST /api/suggest-panel` | Cheapest panel clearing the historical quality floor within a budget |
| `GET /api/spend` | UTC day/month spend vs caps, alert level, remaining |
| `POST /api/compare` | SSE: `started` → `panel_started` / `panel_token` / `panel_retry` / `panel_completed` / `panel_error` / `panel_skipped` → `synthesis` → `recommendation` → `done` (envelope + totals). Deep/async → **202** `{job_id, experiment_id}` |
| `GET /api/jobs/{id}` · `POST /api/jobs/{id}/cancel` | Async job snapshot (partial output while running) / cancel |
| `POST /api/compare/{id}/cancel` | Cancel a streaming run; partial results preserved and labeled |
| `POST /api/experiments/{id}/retry-failed` | Re-run failed/skipped/cancelled panels in place, re-judge, recompute envelope |
| `POST /api/test-connection` | Live key probe via the judge model |
| `GET /api/experiments` · `GET /api/experiments/{id}` | History |
| `POST /api/experiments/{id}/preference` | Preferred model + reason |
| `POST /api/experiments/{id}/recommend` | Recompute recommendation with current settings |
| `GET /api/experiments/{id}/export?format=json\|md` | Download (badges, notes, burned costs included) |
| `GET /api/stats` | Per-model aggregates, preference wins, quality history |

## Key design decisions (mirrors the design doc)

- **SSE orchestration, not request/response.** Tokens stream per panel the moment they arrive (`panel_token`), with an async job fallback for Deep mode. The run is decoupled from the connection: a client disconnect triggers graceful cancellation and still persists labeled partial results.
- **Full fan-out with error isolation.** Each model is its own task under a concurrency semaphore; a failure becomes a labeled `error` run, never an exception that sinks the comparison. Per-model **circuit breakers** (3 consecutive failures → 60s cooldown → half-open probe) and one jittered retry for transient errors (429/5xx/timeouts).
- **Failure envelope (HTTP 200 ≠ success).** Every run ends with `overall_status` ∈ ok / partial / degraded / failed / cancelled plus human-readable `status_notes`. Synthesis is **gated by a quorum of 2** ok panels — a single-model result is never presented as multi-model synthesis. Judge failures fall back to a clearly labeled heuristic (no fabricated scores) and mark the run degraded.
- **LLM-as-judge, separate artifact.** The judge produces labeled JSON (agreements, attributed differences, weaknesses with confidence, uncertainty, per-model quality scores). Originals are stored and displayed unaltered. Reliability: scores-first schema, 8192-token judge budget, truncated-JSON repair, one compact retry. Score keys are canonicalized to model ids so recommendation/UI/history lookups are deterministic.
- **Blind comparison.** Answers are Model A–D until the user clicks **Reveal**; the judge's prose is masked too, so preference data stays unbiased. Revealing is a user action, never automatic.
- **Budget-first experience.** Pre-run worst-case **estimate**; per-request **$ cap** with reservation accounting (panels that cannot fit are **skipped and labeled**, never silently dropped); **Run cheaper** (2 cheapest models, no judge, reasoning off, smaller budget) and **Suggest panel** (cheapest subset clearing the historical quality floor); **daily/monthly spend caps** that block runs before invocation and alert at 80%.
- **Reasoning budgets.** Reasoning on/off per run and per model, with verified per-model knobs and an honest pre-run trade-off note. MiniMax only supports a partial reduction and is labeled as such.
- **Aggressive caching, honestly labeled.** Exact (normalized prompt + model + params) and semantic (lexical Jaccard ≥ 0.85, labeled with the similarity score) tiers with a freshness TTL; hits are **$0** and badged with their age; ranking uses the original generation latency. Concurrent identical calls are deduped (single-flight). Upstream prompt-prefix caching is surfaced via `usage.cached_tokens`. **Fresh run** bypasses everything.
- **Honest metering.** Tokens come from API `usage` (estimated ~4 chars/token only when absent, flagged `*`). Failed panels that burned upstream tokens (e.g. reasoning-only output) record those tokens and cost instead of claiming $0. Cancelled runs carry an explicit note that partial upstream costs may not be reflected. Pricing is an **illustrative placeholder table**.
- **Recommendation from real metrics.** Composite = `0.5·quality + 0.3·cost-efficiency + 0.2·latency-efficiency`; **adaptive escalation** overrides the balanced pick below the quality threshold. Reasons are explicit — no fabricated numbers.
- **Preference as evaluation data.** Picks + reasons persist per experiment — the seed of a preference dataset.

**Verification (2026-11-23):** backend smoke suite **23/23** (streaming event order + tokens, reasoning-off honored, exact/semantic cache hits at $0, budget skips + degraded envelope, retry-failed → 4/4 ok, cancel → cancelled envelope with partials, Deep 202 → polling partial output → completed + persisted). Full browser journey verified: Fast/Balanced/Deep runs, live streaming render, blind reveal + masked synthesis, reasoning toggles, Run cheaper / Suggest panel, cache badges, budget-skip badges, spend WARN + hard block, retry-failed (success and honest failure with burned-cost metering), cancel mid-run, preference save, exports, all six views. `npm run build` passes.

## Production next steps (roadmap)

1. Verification layer: retrieval/grounding for Deep mode and citation-checked synthesis (needs a search provider).
2. Embedding-based semantic cache; calibrate similarity thresholds against human judgments.
3. Learned router trained on the preference dataset; track judge–human agreement over time.
4. Real auth (DO OAuth / API keys) + per-user rate limits and budget quotas; Postgres instead of SQLite; OpenTelemetry traces per experiment.
5. Source pricing from the DO Model Catalog; per-tier model entitlements from the catalog API.