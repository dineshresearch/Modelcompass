"""Answer cache: exact-match + semantic (lexical-similarity) tiers with TTL and
freshness timestamps, plus single-flight dedup of concurrent identical calls.

Honesty contract: cache hits cost $0 inference and are always labeled with the
hit tier, similarity (semantic), and the original generation timestamp. The
semantic tier is lexical (token-set Jaccard), not embedding-based — it is
labeled as such; embedding similarity is a roadmap upgrade. Prompt-prefix
caching happens upstream (usage.prompt_tokens_details.cached_tokens) and is
surfaced in run metrics, not reinvented here.
"""
import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone

from . import store

SEMANTIC_THRESHOLD = 0.85


def _norm(prompt: str) -> str:
    return re.sub(r"\s+", " ", prompt).strip()


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9']+", text.lower()))


def cache_key(model: str, prompt: str, max_tokens: int, reasoning: bool) -> str:
    raw = json.dumps([model, _norm(prompt), int(max_tokens), bool(reasoning)], ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _params(max_tokens: int, reasoning: bool) -> str:
    return json.dumps([int(max_tokens), bool(reasoning)])


def _age_s(created_at: str) -> float:
    try:
        created = datetime.fromisoformat(created_at)
    except ValueError:
        return float("inf")
    return (datetime.now(timezone.utc) - created).total_seconds()


def _hit(row, tier: str, similarity: float | None = None) -> dict:
    return {
        "model": row["model"],
        "status": "ok",
        "output": row["output"],
        "error": None,
        "latency_ms": 0.0,
        "input_tokens": row["input_tokens"],
        "output_tokens": row["output_tokens"],
        "tokens_estimated": bool(row["tokens_estimated"]),
        "est_cost_usd": 0.0,
        "retried": False,
        "max_tokens_used": None,
        "cache_hit": tier,
        "cache_similarity": similarity,
        "cached_at": row["created_at"],
        "original_latency_ms": row["latency_ms"],
    }


def lookup(model: str, prompt: str, max_tokens: int, reasoning: bool, ttl_s: float, bypass: bool = False) -> dict | None:
    if bypass or ttl_s <= 0:
        return None
    key = cache_key(model, prompt, max_tokens, reasoning)
    with store._lock, store._conn() as conn:
        row = conn.execute("SELECT * FROM cache WHERE key = ?", (key,)).fetchone()
        if row and _age_s(row["created_at"]) <= ttl_s:
            conn.execute("UPDATE cache SET hits = hits + 1 WHERE key = ?", (key,))
            return _hit(row, "exact")
        # Semantic tier: same model + params, recent entries, lexical similarity.
        rows = conn.execute(
            "SELECT * FROM cache WHERE model = ? AND params = ? ORDER BY created_at DESC LIMIT 200",
            (model, _params(max_tokens, reasoning)),
        ).fetchall()
    want = _tokens(_norm(prompt))
    if not want:
        return None
    best, best_jac = None, 0.0
    for row in rows:
        if _age_s(row["created_at"]) > ttl_s:
            continue
        have = _tokens(row["prompt"])
        union = want | have
        jac = len(want & have) / len(union) if union else 0.0
        if jac > best_jac:
            best, best_jac = row, jac
    if best is not None and best_jac >= SEMANTIC_THRESHOLD:
        with store._lock, store._conn() as conn:
            conn.execute("UPDATE cache SET hits = hits + 1 WHERE key = ?", (best["key"],))
        return _hit(best, "semantic", round(best_jac, 2))
    return None


def put(model: str, prompt: str, max_tokens: int, reasoning: bool, run: dict) -> None:
    if run.get("status") != "ok" or not run.get("output"):
        return
    key = cache_key(model, prompt, max_tokens, reasoning)
    with store._lock, store._conn() as conn:
        conn.execute(
            "INSERT INTO cache (key, model, prompt, params, output, input_tokens, output_tokens, tokens_estimated, latency_ms, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET output = excluded.output, input_tokens = excluded.input_tokens, "
            "output_tokens = excluded.output_tokens, tokens_estimated = excluded.tokens_estimated, "
            "latency_ms = excluded.latency_ms, created_at = excluded.created_at",
            (key, model, _norm(prompt), _params(max_tokens, reasoning), run["output"],
             run.get("input_tokens", 0), run.get("output_tokens", 0),
             int(run.get("tokens_estimated", False)), run.get("latency_ms", 0.0),
             datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )


# ---- single-flight dedup: concurrent identical calls share one upstream call ----
_flights: dict[str, asyncio.Future] = {}


def acquire_flight(key: str) -> tuple[asyncio.Future, bool]:
    fut = _flights.get(key)
    if fut is not None and not fut.done():
        return fut, False
    fut = asyncio.get_running_loop().create_future()
    _flights[key] = fut
    return fut, True


def resolve_flight(key: str, run: dict) -> None:
    fut = _flights.pop(key, None)
    if fut is not None and not fut.done():
        fut.set_result(run)