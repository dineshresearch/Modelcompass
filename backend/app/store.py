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
"""

DEFAULT_SETTINGS = {
    "latency_slo_s": 2.0,
    "quality_threshold": 80,
    "adaptive_escalation": True,
    "max_tokens": MAX_TOKENS_DEFAULT,
    "synthesize": True,
    "judge_model": JUDGE_MODEL,
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
        if "recommendation" not in cols:
            conn.execute("ALTER TABLE experiments ADD COLUMN recommendation TEXT")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def save_experiment(exp: dict, runs: list[dict]) -> None:
    with _lock, _conn() as conn:
        conn.execute(
            "INSERT INTO experiments (id, created_at, mode, prompt, max_tokens, synthesis, judge_metrics, recommendation, total_cost_usd, total_latency_ms) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                exp["id"], exp["created_at"], exp["mode"], exp["prompt"], exp["max_tokens"],
                json.dumps(exp["synthesis"]) if exp.get("synthesis") else None,
                json.dumps(exp["judge_metrics"]) if exp.get("judge_metrics") else None,
                json.dumps(exp["recommendation"]) if exp.get("recommendation") else None,
                exp.get("total_cost_usd", 0.0), exp.get("total_latency_ms", 0.0),
            ),
        )
        conn.executemany(
            "INSERT INTO runs (experiment_id, position, model, status, output, error, latency_ms, input_tokens, output_tokens, tokens_estimated, est_cost_usd) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [
                (exp["id"], i, r["model"], r["status"], r.get("output"), r.get("error"),
                 r.get("latency_ms", 0.0), r.get("input_tokens", 0), r.get("output_tokens", 0),
                 int(r.get("tokens_estimated", False)), r.get("est_cost_usd", 0.0))
                for i, r in enumerate(runs)
            ],
        )


def _run_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["tokens_estimated"] = bool(d["tokens_estimated"])
    d.pop("position", None)
    return d


def get_experiment(exp_id: str) -> dict | None:
    with _lock, _conn() as conn:
        row = conn.execute("SELECT * FROM experiments WHERE id = ?", (exp_id,)).fetchone()
        if not row:
            return None
        exp = dict(row)
        for key in ("synthesis", "judge_metrics", "recommendation"):
            exp[key] = json.loads(exp[key]) if exp[key] else None
        exp["runs"] = [
            _run_dict(r)
            for r in conn.execute("SELECT * FROM runs WHERE experiment_id = ? ORDER BY position", (exp_id,))
        ]
        return exp


def list_experiments(limit: int = 50) -> list[dict]:
    with _lock, _conn() as conn:
        rows = conn.execute(
            "SELECT e.id, e.created_at, e.mode, e.prompt, e.preferred_model, e.total_cost_usd, "
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