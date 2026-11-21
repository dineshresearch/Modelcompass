"""Parallel orchestration: one prompt, N models, isolated failures."""
import asyncio
import time

from . import config
from .catalog import est_cost_usd
from .providers import live_call


async def run_one(model_id: str, prompt: str, max_tokens: int) -> dict:
    """Run a single model; NEVER raises — failures become isolated error runs."""
    t0 = time.perf_counter()
    try:
        res = await asyncio.wait_for(
            live_call(model_id, prompt, max_tokens), timeout=config.REQUEST_TIMEOUT_S + 5
        )
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
        }


def make_tasks(model_ids: list[str], prompt: str, max_tokens: int) -> list[asyncio.Task]:
    """Bounded-concurrency fan-out over the selected models."""
    sem = asyncio.Semaphore(config.MAX_CONCURRENCY)

    async def guarded(mid: str) -> dict:
        async with sem:
            return await run_one(mid, prompt, max_tokens)

    return [asyncio.create_task(guarded(mid)) for mid in model_ids]