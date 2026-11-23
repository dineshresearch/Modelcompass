"""Run orchestrator: parallel fan-out, streaming panel events, cost guard,
circuit breakers, cancellation, and the explicit failure contract.

SSE event contract (design doc #2/#4):
  started -> panel_started / panel_token / panel_retry ->
  panel_completed | panel_error | panel_skipped (per model) ->
  synthesis (gated) -> recommendation -> done (overall_status envelope).
"""
import asyncio
import random
import time
from datetime import datetime, timezone

from . import cache, config, store
from .catalog import est_cost_usd
from .costguard import BudgetGuard, estimate_run, tokens_est
from .providers import InferenceError, live_call
from .recommend import recommend
from .synthesis import heuristic_synthesis, synthesize_live

SYNTHESIS_QUORUM = 2  # a single-model result is never presented as multi-model synthesis


class CircuitBreaker:
    """Per-model breaker: 3 consecutive failures open the circuit for a cooldown;
    after cooldown one half-open probe is allowed (next failure re-opens)."""

    THRESHOLD = 3
    COOLDOWN_S = 60.0

    def __init__(self):
        self.failures: dict[str, int] = {}
        self.opened_at: dict[str, float] = {}

    def allow(self, model: str) -> tuple[bool, str]:
        opened = self.opened_at.get(model)
        if opened is None:
            return True, "closed"
        if time.monotonic() - opened < self.COOLDOWN_S:
            return False, "open"
        return True, "half_open"

    def record(self, model: str, ok: bool) -> None:
        if ok:
            self.failures.pop(model, None)
            self.opened_at.pop(model, None)
            return
        n = self.failures.get(model, 0) + 1
        self.failures[model] = n
        if n >= self.THRESHOLD:
            self.opened_at[model] = time.monotonic()


BREAKER = CircuitBreaker()


def _base_run(model: str, reasoning: bool) -> dict:
    return {
        "model": model, "status": "error", "output": None, "error": None, "error_kind": None,
        "latency_ms": 0.0, "input_tokens": 0, "output_tokens": 0, "tokens_estimated": False,
        "est_cost_usd": 0.0, "retried": False, "max_tokens_used": None, "reasoning": reasoning,
        "reasoning_tokens": None, "upstream_cached_tokens": 0, "streamed": False,
        "cache_hit": None, "cached_at": None, "original_latency_ms": None, "cache_similarity": None,
    }


async def run_one(
    model: str, prompt: str, max_tokens: int, reasoning: bool,
    budget: BudgetGuard, cancel_event: asyncio.Event, refresh: bool, on_event,
) -> dict:
    """One panel. NEVER raises: failures become isolated, labeled error runs."""
    t0 = time.perf_counter()
    run = _base_run(model, reasoning)
    settings = store.get_settings()
    ttl = float(settings.get("cache_ttl_s", 3600)) if settings.get("cache_enabled", True) else 0

    def emit(ev: dict) -> None:
        on_event(ev)

    def finish(status: str, error: str | None = None, kind: str | None = None) -> dict:
        run["status"] = status
        run["error"] = error
        run["error_kind"] = kind
        run["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        return run

    if cancel_event.is_set():
        run = finish("cancelled", "Cancelled before launch", "cancelled")
        emit({"type": "panel_error", "run": run})
        return run

    allowed, state = BREAKER.allow(model)
    if not allowed:
        run = finish("error", f"Circuit open for {model} after {BREAKER.THRESHOLD} consecutive failures; cooling down ({BREAKER.COOLDOWN_S:.0f}s). Retry shortly.", "circuit_open")
        emit({"type": "panel_error", "run": run})
        return run

    # Cache tiers: exact / semantic. Hits are free and labeled with freshness.
    hit = await asyncio.to_thread(cache.lookup, model, prompt, max_tokens, reasoning, ttl, refresh)
    if hit:
        run.update(hit)
        run["reasoning"] = reasoning
        run["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        emit({"type": "panel_started", "model": model, "reasoning": reasoning, "cache_hit": hit["cache_hit"]})
        emit({"type": "panel_completed", "run": run})
        return run

    est = est_cost_usd(model, tokens_est(prompt), max_tokens)
    if not budget.try_reserve(est):
        run = finish("skipped", f"Skipped: per-request budget cap ${budget.cap:.4f} cannot fit this panel's worst-case estimate ${est:.6f}. Labeled partial result, not a failure.", "budget")
        emit({"type": "panel_skipped", "run": run})
        return run

    # Single-flight dedup: an identical in-flight call shares one upstream request.
    key = cache.cache_key(model, prompt, max_tokens, reasoning)
    flight, owner = cache.acquire_flight(key)
    if not owner:
        shared = await flight
        run.update(shared)
        run["reasoning"] = reasoning
        if shared.get("status") == "ok":
            run["cache_hit"] = "dedup"
            run["est_cost_usd"] = 0.0
            run["original_latency_ms"] = shared.get("latency_ms")
            run["latency_ms"] = 0.0
        budget.commit(run["est_cost_usd"], est)
        emit({"type": "panel_started", "model": model, "reasoning": reasoning, "cache_hit": run["cache_hit"]})
        emit({"type": "panel_completed" if run["status"] == "ok" else "panel_error", "run": run})
        return run

    emit({"type": "panel_started", "model": model, "reasoning": reasoning, "cache_hit": None})
    budget_used = max_tokens
    retried_budget = retried_transient = False
    try:
        while True:
            if cancel_event.is_set():
                raise InferenceError("Cancelled by user", kind="cancelled")
            try:
                res = await live_call(
                    model, prompt, budget_used, reasoning=reasoning,
                    on_token=lambda piece: emit({"type": "panel_token", "model": model, "text": piece}),
                    cancel_event=cancel_event,
                )
                break
            except InferenceError as e:
                if e.kind == "cancelled":
                    raise
                if not retried_budget and "Empty final content" in str(e) and budget_used < config.MAX_TOKENS_CAP:
                    retried_budget = True
                    budget_used = min(budget_used * 2, config.MAX_TOKENS_CAP)
                    emit({"type": "panel_retry", "model": model, "reason": "empty content (reasoning headroom)", "max_tokens": budget_used})
                    continue
                transient = e.kind in ("rate_limited", "timeout") or (e.status_code or 0) >= 500
                if not retried_transient and transient:
                    retried_transient = True
                    delay = 1.0 + random.uniform(0, 0.5)  # backoff + jitter
                    emit({"type": "panel_retry", "model": model, "reason": f"transient {e.kind}; retry in {delay:.1f}s", "max_tokens": budget_used})
                    await asyncio.sleep(delay)
                    continue
                raise
        run.update({
            "status": "ok", "output": res["output"], "error": None, "error_kind": None,
            "input_tokens": res["input_tokens"], "output_tokens": res["output_tokens"],
            "tokens_estimated": res["tokens_estimated"],
            "est_cost_usd": round(est_cost_usd(model, res["input_tokens"], res["output_tokens"]), 6),
            "retried": retried_budget or retried_transient, "max_tokens_used": budget_used,
            "reasoning_tokens": res.get("reasoning_tokens"), "upstream_cached_tokens": res.get("upstream_cached_tokens", 0),
            "streamed": res.get("streamed", False),
        })
        run["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        BREAKER.record(model, True)
        budget.commit(run["est_cost_usd"], est)
        await asyncio.to_thread(cache.put, model, prompt, max_tokens, reasoning, run)
        cache.resolve_flight(key, run)
        emit({"type": "panel_completed", "run": run})
        return run
    except asyncio.CancelledError:
        run["retried"] = retried_budget or retried_transient
        run["max_tokens_used"] = budget_used
        run = finish("cancelled", "Cancelled by user", "cancelled")
        budget.release(est)
        cache.resolve_flight(key, run)
        emit({"type": "panel_error", "run": run})
        return run
    except Exception as e:  # noqa: BLE001 — error isolation is the point
        kind = getattr(e, "kind", None) or ("timeout" if isinstance(e, (asyncio.TimeoutError, TimeoutError)) else "failed")
        if isinstance(e, asyncio.TimeoutError):
            msg = f"Timed out after {config.REQUEST_TIMEOUT_S:.0f}s"
        else:
            msg = f"{type(e).__name__}: {e}"
        run["retried"] = retried_budget or retried_transient
        run["max_tokens_used"] = budget_used
        # Honest metering: a failed call may still have burned upstream tokens
        # (e.g. reasoning-only output). Record them instead of claiming $0.
        u = getattr(e, "usage", None) or {}
        burned = int(u.get("completion_tokens") or 0) + int(u.get("prompt_tokens") or 0)
        if burned:
            run["input_tokens"] = int(u.get("prompt_tokens") or 0)
            run["output_tokens"] = int(u.get("completion_tokens") or 0)
            run["est_cost_usd"] = round(est_cost_usd(model, run["input_tokens"], run["output_tokens"]), 6)
        run = finish("cancelled" if kind == "cancelled" else "error", msg, kind)
        if kind != "cancelled":
            BREAKER.record(model, False)
        if burned:
            budget.commit(run["est_cost_usd"], est)
        else:
            budget.release(est)
        cache.resolve_flight(key, run)
        emit({"type": "panel_error", "run": run})
        return run


async def stream_panels(
    models: list[str], prompt: str, max_tokens: int, reasoning_map: dict[str, bool],
    budget: BudgetGuard, cancel_event: asyncio.Event, refresh: bool, registry: dict | None = None,
):
    """Bounded-concurrency fan-out; yields panel events the moment they happen."""
    sem = asyncio.Semaphore(config.MAX_CONCURRENCY)
    q: asyncio.Queue = asyncio.Queue()

    async def guarded(mid: str) -> dict:
        async with sem:
            return await run_one(mid, prompt, max_tokens, reasoning_map.get(mid, True), budget, cancel_event, refresh, q.put_nowait)

    tasks = [asyncio.create_task(guarded(mid)) for mid in models]
    if registry is not None:
        registry["tasks"] = tasks
    terminal = {"panel_completed", "panel_error", "panel_skipped"}
    done = 0
    try:
        while done < len(models):
            ev = await q.get()
            yield ev
            if ev["type"] in terminal:
                done += 1
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _envelope(runs: list[dict], synthesis: dict | None, syn_requested: bool, cancelled: bool) -> str:
    ok = [r for r in runs if r["status"] == "ok"]
    bad = [r for r in runs if r["status"] != "ok"]
    if cancelled:
        return "cancelled"
    if not ok:
        return "failed"
    if bad:
        return "partial" if len(ok) >= SYNTHESIS_QUORUM else "degraded"
    if syn_requested and (synthesis is None or synthesis.get("fallback")):
        return "degraded"
    return "ok"


async def run_experiment(params: dict, settings: dict, exp_id: str, cancel_event: asyncio.Event, registry: dict | None = None):
    """Full experiment as an event generator: panels -> gated synthesis ->
    recommendation -> persisted experiment -> done envelope. Shared by the SSE
    endpoint and the async job runner (Deep mode / streaming fallback)."""
    prompt = params["prompt"]
    models = params["models"]
    max_tokens = params["max_tokens"]
    syn_requested = bool(params.get("synthesize", True))
    reasoning_map = params.get("reasoning_map") or {}
    budget = BudgetGuard(params.get("budget_usd"))
    started = time.perf_counter()
    notes: list[str] = []

    yield {
        "type": "started", "experiment_id": exp_id, "models": models,
        "run_mode": params.get("run_mode", "custom"), "budget_usd": params.get("budget_usd"),
        "max_tokens": max_tokens, "synthesize": syn_requested,
    }

    runs_by_model: dict[str, dict] = {}
    async for ev in stream_panels(models, prompt, max_tokens, reasoning_map, budget, cancel_event, bool(params.get("refresh")), registry):
        yield ev
        if ev["type"] in ("panel_completed", "panel_error", "panel_skipped"):
            runs_by_model[ev["run"]["model"]] = ev["run"]
    runs = [runs_by_model[m] for m in models if m in runs_by_model]
    ok_runs = [r for r in runs if r["status"] == "ok"]

    for r in runs:
        if r["status"] == "skipped":
            notes.append(f"{r['model']}: skipped — per-request budget cap reached (labeled partial, not a failure).")
        elif r["status"] == "cancelled":
            notes.append(f"{r['model']}: cancelled by user.")
        elif r["status"] == "error":
            notes.append(f"{r['model']}: {r['error_kind'] or 'failed'} — {r['error']}")

    synthesis, judge_metrics = None, None
    cancelled = cancel_event.is_set()
    if cancelled:
        notes.append("Run cancelled by user; partial results preserved. Cancelled panels may have incurred partial upstream token costs that are not reflected in the totals.")
    elif syn_requested and len(ok_runs) >= SYNTHESIS_QUORUM:
        judge_est = estimate_run([r["model"] for r in ok_runs], prompt, max_tokens, True, settings["judge_model"])["judge"]
        judge_est_usd = judge_est["est_cost_usd"] if judge_est else 0.0
        if not budget.try_reserve(judge_est_usd):
            notes.append(f"Synthesis skipped: judge estimate ${judge_est_usd:.6f} does not fit the remaining per-request budget.")
        else:
            try:
                synthesis, judge_metrics = await synthesize_live(prompt, ok_runs, settings["judge_model"])
                budget.commit((judge_metrics or {}).get("est_cost_usd", 0.0), judge_est_usd)
            except Exception as e:  # noqa: BLE001 — synthesis failure must not lose the runs
                budget.release(judge_est_usd)
                synthesis = heuristic_synthesis(ok_runs, note=f"Synthesis judge failed ({type(e).__name__}); showing heuristic comparison.")
                judge_metrics = None
            if synthesis.get("fallback"):
                notes.append("Judge failed; heuristic fallback shown (no quality scores). Result marked degraded.")
            yield {"type": "synthesis", "synthesis": synthesis, "judge_metrics": judge_metrics}
    elif syn_requested and len(ok_runs) == 1:
        notes.append(f"Synthesis skipped: only 1 of {len(runs)} panels succeeded (quorum {SYNTHESIS_QUORUM}). A single-model result is never presented as multi-model synthesis.")
    elif syn_requested and not ok_runs:
        notes.append("Synthesis skipped: no panels succeeded.")

    rec = recommend(runs, synthesis, settings)
    if rec:
        yield {"type": "recommendation", "recommendation": rec}

    overall_status = _envelope(runs, synthesis, syn_requested, cancelled)
    total_cost = sum(r["est_cost_usd"] for r in runs) + (judge_metrics or {}).get("est_cost_usd", 0.0)
    wall_ms = round((time.perf_counter() - started) * 1000, 1)
    exp = {
        "id": exp_id,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": config.MODE,
        "run_mode": params.get("run_mode", "custom"),
        "prompt": prompt,
        "max_tokens": max_tokens,
        "budget_usd": params.get("budget_usd"),
        "synthesis": synthesis,
        "judge_metrics": judge_metrics,
        "recommendation": rec,
        "overall_status": overall_status,
        "status_notes": notes,
        "synthesize": syn_requested,
        "total_cost_usd": round(total_cost, 6),
        "total_latency_ms": wall_ms,
    }
    await asyncio.to_thread(store.save_experiment, exp, runs)
    yield {
        "type": "done",
        "experiment_id": exp_id,
        "overall_status": overall_status,
        "status_notes": notes,
        "totals": {
            "cost_usd": round(total_cost, 6),
            "wall_latency_ms": wall_ms,
            "models_ok": len(ok_runs),
            "models_failed": sum(1 for r in runs if r["status"] == "error"),
            "models_skipped": sum(1 for r in runs if r["status"] == "skipped"),
            "models_cancelled": sum(1 for r in runs if r["status"] == "cancelled"),
            "cache_hits": sum(1 for r in runs if r.get("cache_hit")),
            "budget": {"cap_usd": budget.cap, "spent_usd": round(budget.spent, 6), "remaining_usd": budget.remaining},
        },
    }