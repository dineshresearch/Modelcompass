"""SQLite persistence: experiment history, per-model runs, preferences, settings."""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from .config import DB_PATH, JUDGE_MODEL, MAX_TOKENS_DEFAULT

_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    prompt TEXT NOT NULL,
    max_tokens INTEGER,
    synthesis TEXT,
    judge_metrics TEXT,
    recommendation TEXT,
    total_cost_usd REAL,
    total_latency_ms REAL,
    preferred_model TEXT,
    preference_reason TEXT,
    preferred_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
    experiment_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    output TEXT,
    error TEXT,
    latency_ms REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    tokens_estimated INTEGER,
    est_cost_usd REAL,
    PRIMARY KEY (experiment_id, position)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    params TEXT NOT NULL,
    output TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    tokens_estimated INTEGER,
    latency_ms REAL,
    created_at TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cache_model ON cache(model, created_at);
"""

DEFAULT_SETTINGS = {
    "latency_slo_s": 2.0,
    "quality_threshold": 80,
    "adaptive_escalation": True,
    "max_tokens": MAX_TOKENS_DEFAULT,
    "synthesize": True,
    "judge_model": JUDGE_MODEL,
    "cache_enabled": True,
    "cache_ttl_s": 3600,
    "daily_budget_usd": 0.0,
    "monthly_budget_usd": 0.0,
}

# Columns added after the first PoC schema; migrated in init_db.
_EXP_COLS = {
    "recommendation": "TEXT",
    "overall_status": "TEXT",
    "run_mode": "TEXT",
    "budget_usd": "REAL",
    "status_notes": "TEXT",
    "synthesize": "INTEGER",
}
_RUN_COLS = {
    "retried": "INTEGER DEFAULT 0",
    "max_tokens_used": "INTEGER",
    "error_kind": "TEXT",
    "cache_hit": "TEXT",
    "cached_at": "TEXT",
    "original_latency_ms": "REAL",
    "reasoning": "INTEGER DEFAULT 1",
}


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock, _conn() as conn:
        conn.executescript(_SCHEMA)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(experiments)")}
        for name, decl in _EXP_COLS.items():
            if name not in cols:
                conn.execute(f"ALTER TABLE experiments ADD COLUMN {name} {decl}")
        rcols = {r["name"] for r in conn.execute("PRAGMA table_info(runs)")}
        for name, decl in _RUN_COLS.items():
            if name not in rcols:
                conn.execute(f"ALTER TABLE runs ADD COLUMN {name} {decl}")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def save_experiment(exp: dict, runs: list[dict]) -> None:
    with _lock, _conn() as conn:
        conn.execute(
            "INSERT INTO experiments (id, created_at, mode, prompt, max_tokens, synthesis, judge_metrics, recommendation, total_cost_usd, total_latency_ms, overall_status, run_mode, budget_usd, status_notes, synthesize) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                exp["id"], exp["created_at"], exp["mode"], exp["prompt"], exp["max_tokens"],
                json.dumps(exp["synthesis"]) if exp.get("synthesis") else None,
                json.dumps(exp["judge_metrics"]) if exp.get("judge_metrics") else None,
                json.dumps(exp["recommendation"]) if exp.get("recommendation") else None,
                exp.get("total_cost_usd", 0.0), exp.get("total_latency_ms", 0.0),
                exp.get("overall_status"), exp.get("run_mode"), exp.get("budget_usd"),
                json.dumps(exp["status_notes"]) if exp.get("status_notes") else None,
                int(exp.get("synthesize", True)),
            ),
        )
        _insert_runs(conn, exp["id"], runs)


def _insert_runs(conn: sqlite3.Connection, exp_id: str, runs: list[dict]) -> None:
    conn.executemany(
        "INSERT INTO runs (experiment_id, position, model, status, output, error, latency_ms, input_tokens, output_tokens, tokens_estimated, est_cost_usd, retried, max_tokens_used, error_kind, cache_hit, cached_at, original_latency_ms, reasoning) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (exp_id, i, r["model"], r["status"], r.get("output"), r.get("error"),
             r.get("latency_ms", 0.0), r.get("input_tokens", 0), r.get("output_tokens", 0),
             int(r.get("tokens_estimated", False)), r.get("est_cost_usd", 0.0),
             int(r.get("retried", False)), r.get("max_tokens_used"), r.get("error_kind"),
             r.get("cache_hit"), r.get("cached_at"), r.get("original_latency_ms"),
             int(r.get("reasoning", True)))
            for i, r in enumerate(runs)
        ],
    )


def replace_runs(exp_id: str, runs: list[dict], exp_updates: dict) -> None:
    """Retry-failed: swap in updated runs and refresh experiment-level fields."""
    with _lock, _conn() as conn:
        conn.execute("DELETE FROM runs WHERE experiment_id = ?", (exp_id,))
        _insert_runs(conn, exp_id, runs)
        sets, vals = [], []
        for key in ("synthesis", "judge_metrics", "recommendation", "status_notes"):
            if key in exp_updates:
                sets.append(f"{key} = ?")
                vals.append(json.dumps(exp_updates[key]) if exp_updates[key] else None)
        for key in ("total_cost_usd", "total_latency_ms", "overall_status"):
            if key in exp_updates:
                sets.append(f"{key} = ?")
                vals.append(exp_updates[key])
        if sets:
            vals.append(exp_id)
            conn.execute(f"UPDATE experiments SET {', '.join(sets)} WHERE id = ?", vals)


def _run_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["tokens_estimated"] = bool(d["tokens_estimated"])
    d["retried"] = bool(d.get("retried"))
    d["reasoning"] = bool(d.get("reasoning", 1))
    d.pop("position", None)
    return d


def get_experiment(exp_id: str) -> dict | None:
    with _lock, _conn() as conn:
        row = conn.execute("SELECT * FROM experiments WHERE id = ?", (exp_id,)).fetchone()
        if not row:
            return None
        exp = dict(row)
        for key in ("synthesis", "judge_metrics", "recommendation", "status_notes"):
            exp[key] = json.loads(exp[key]) if exp[key] else None
        exp["runs"] = [
            _run_dict(r)
            for r in conn.execute("SELECT * FROM runs WHERE experiment_id = ? ORDER BY position", (exp_id,))
        ]
        return exp


def list_experiments(limit: int = 50) -> list[dict]:
    with _lock, _conn() as conn:
        rows = conn.execute(
            "SELECT e.id, e.created_at, e.mode, e.run_mode, e.overall_status, e.prompt, e.preferred_model, e.total_cost_usd, "
            "json_extract(e.recommendation, '$.model_label') AS best_fit, "
            "json_extract(e.recommendation, '$.strategy') AS strategy, "
            "(SELECT COUNT(*) FROM runs r WHERE r.experiment_id = e.id) AS n_models, "
            "(SELECT COUNT(*) FROM runs r WHERE r.experiment_id = e.id AND r.status = 'ok') AS n_ok "
            "FROM experiments e ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def set_preference(exp_id: str, model: str, reason: str) -> dict | None:
    with _lock, _conn() as conn:
        run = conn.execute(
            "SELECT status FROM runs WHERE experiment_id = ? AND model = ?", (exp_id, model)
        ).fetchone()
        if not run:
            return None
        if run["status"] != "ok":
            raise ValueError("Cannot prefer a model whose run failed")
        conn.execute(
            "UPDATE experiments SET preferred_model = ?, preference_reason = ?, preferred_at = ? WHERE id = ?",
            (model, reason, _now(), exp_id),
        )
    return get_experiment(exp_id)


def set_recommendation(exp_id: str, rec: dict | None) -> None:
    with _lock, _conn() as conn:
        conn.execute(
            "UPDATE experiments SET recommendation = ? WHERE id = ?",
            (json.dumps(rec) if rec else None, exp_id),
        )


def get_settings() -> dict:
    with _lock, _conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    out = dict(DEFAULT_SETTINGS)
    for r in rows:
        try:
            out[r["key"]] = json.loads(r["value"])
        except json.JSONDecodeError:
            pass
    return out


def put_settings(updates: dict) -> dict:
    with _lock, _conn() as conn:
        for k, v in updates.items():
            if k in DEFAULT_SETTINGS and v is not None:
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (k, json.dumps(v)),
                )
    return get_settings()


def stats() -> dict:
    with _lock, _conn() as conn:
        per_model = [
            dict(r)
            for r in conn.execute(
                "SELECT model, COUNT(*) AS runs, SUM(status='ok') AS ok, SUM(status='error') AS errors, "
                "AVG(CASE WHEN status='ok' THEN latency_ms END) AS avg_latency_ms, "
                "SUM(est_cost_usd) AS est_cost_usd FROM runs GROUP BY model ORDER BY runs DESC"
            )
        ]
        wins = {
            r["preferred_model"]: r["wins"]
            for r in conn.execute(
                "SELECT preferred_model, COUNT(*) AS wins FROM experiments WHERE preferred_model IS NOT NULL GROUP BY preferred_model"
            )
        }
        totals = dict(
            conn.execute(
                "SELECT COUNT(*) AS experiments, COALESCE(SUM(total_cost_usd),0) AS total_est_cost_usd, "
                "SUM(preferred_model IS NOT NULL) AS preferences_recorded FROM experiments"
            ).fetchone()
        )
    for m in per_model:
        m["preference_wins"] = wins.get(m["model"], 0)
        m["avg_latency_ms"] = round(m["avg_latency_ms"], 1) if m["avg_latency_ms"] is not None else None
    return {**totals, "per_model": per_model}


def model_quality() -> dict:
    """Historical average judge quality per model id (from stored synthesis scores)."""
    from .catalog import MODEL_BY_ID

    label_to_id = {m["label"]: mid for mid, m in MODEL_BY_ID.items()}
    acc: dict[str, list[int]] = {}
    with _lock, _conn() as conn:
        rows = conn.execute("SELECT synthesis FROM experiments WHERE synthesis IS NOT NULL").fetchall()
    for row in rows:
        try:
            syn = json.loads(row["synthesis"])
        except (json.JSONDecodeError, TypeError):
            continue
        if syn.get("fallback"):
            continue
        for label, s in (syn.get("scores") or {}).items():
            mid = label_to_id.get(label, label if label in MODEL_BY_ID else None)
            if mid is None:
                mid = next((m for m in MODEL_BY_ID if m in str(label)), None)
            if mid and isinstance(s, dict) and isinstance(s.get("quality"), int):
                acc.setdefault(mid, []).append(s["quality"])
    return {
        mid: {"avg_quality": round(sum(v) / len(v), 1), "n_scored": len(v)}
        for mid, v in acc.items()
    }


def spend_summary() -> dict:
    """Today / this-month (UTC) estimated spend vs configured caps, with alert levels."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
    with _lock, _conn() as conn:
        day = conn.execute(
            "SELECT COALESCE(SUM(total_cost_usd),0) AS spend, COUNT(*) AS runs FROM experiments WHERE created_at >= ?",
            (day_start,),
        ).fetchone()
        month = conn.execute(
            "SELECT COALESCE(SUM(total_cost_usd),0) AS spend, COUNT(*) AS runs FROM experiments WHERE created_at >= ?",
            (month_start,),
        ).fetchone()

    def level(spend: float, cap: float) -> str:
        if cap <= 0:
            return "off"
        if spend >= cap:
            return "blocked"
        if spend >= 0.8 * cap:
            return "warn"
        return "ok"

    daily_cap = float(settings.get("daily_budget_usd") or 0)
    monthly_cap = float(settings.get("monthly_budget_usd") or 0)
    return {
        "day": {"spend_usd": round(day["spend"], 6), "runs": day["runs"], "cap_usd": daily_cap,
                "remaining_usd": round(max(0.0, daily_cap - day["spend"]), 6) if daily_cap > 0 else None,
                "alert": level(day["spend"], daily_cap)},
        "month": {"spend_usd": round(month["spend"], 6), "runs": month["runs"], "cap_usd": monthly_cap,
                  "remaining_usd": round(max(0.0, monthly_cap - month["spend"]), 6) if monthly_cap > 0 else None,
                  "alert": level(month["spend"], monthly_cap)},
    }