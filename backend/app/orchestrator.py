"""Parallel orchestration: one prompt, N models, isolated failures."""
import asyncio
import time

from . import config
from .catalog import est_cost_usd
from .providers import InferenceError, live_call


async def run_one(model_id: str, prompt: str, max_tokens: int) -> dict:
    """Run a single model; NEVER raises — failures become isolated error runs.

    Reasoning models can spend the entire token budget thinking and return empty
    final content. When that happens, retry once with a doubled budget (up to
    MAX_TOKENS_CAP) before declaring an isolated failure.
    """
    t0 = time.perf_counter()
    budget = max_tokens
    retried = False
    try:
        while True:
            try:
                res = await asyncio.wait_for(
                    live_call(model_id, prompt, budget), timeout=config.REQUEST_TIMEOUT_S + 5
                )
                break
            except InferenceError as e:
                if not retried and "Empty final content" in str(e) and budget < config.MAX_TOKENS_CAP:
                    retried = True
                    budget = min(budget * 2, config.MAX_TOKENS_CAP)
                    continue
                raise
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "model": model_id,
            "status": "ok",
            "output": res["output"],
            "error": None,
            "latency_ms": latency_ms,
            "input_tokens": res["input_tokens"],
            "output_tokens": res["output_tokens"],
            "tokens_estimated": res["tokens_estimated"],
            "est_cost_usd": round(est_cost_usd(model_id, res["input_tokens"], res["output_tokens"]), 6),
            "retried": retried,
            "max_tokens_used": budget,
        }
    except Exception as e:  # noqa: BLE001 — error isolation is the point
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "model": model_id,
            "status": "error",
            "output": None,
            "error": f"{type(e).__name__}: {e}",
            "latency_ms": latency_ms,
            "input_tokens": 0,
            "output_tokens": 0,
            "tokens_estimated": False,
            "est_cost_usd": 0.0,
            "retried": retried,
        }


def make_tasks(model_ids: list[str], prompt: str, max_tokens: int) -> list[asyncio.Task]:
    """Bounded-concurrency fan-out over the selected models."""
    sem = asyncio.Semaphore(config.MAX_CONCURRENCY)

    async def guarded(mid: str) -> dict:
        async with sem:
            return await run_one(mid, prompt, max_tokens)

    return [asyncio.create_task(guarded(mid)) for mid in model_ids]