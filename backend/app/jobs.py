"""Async job registry: Deep mode runs as an opt-in batch job, and any run can
fall back to job_id + polling when streaming is not usable (design doc #2).

GET /api/jobs/{id} reports completed / running / failed panels (with partial
output for running ones), so partial results render within a second.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from .orchestrator import run_experiment

JOBS: dict[str, dict] = {}
ACTIVE_RUNS: dict[str, dict] = {}  # experiment_id -> {cancel, registry} for live SSE runs


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def register_active(exp_id: str, cancel: asyncio.Event, registry: dict) -> None:
    ACTIVE_RUNS[exp_id] = {"cancel": cancel, "registry": registry}


def unregister_active(exp_id: str) -> None:
    ACTIVE_RUNS.pop(exp_id, None)


def cancel_experiment(exp_id: str) -> bool:
    """Cancel a live SSE run or an async job by experiment id."""
    active = ACTIVE_RUNS.get(exp_id)
    if active:
        active["cancel"].set()
        for t in active["registry"].get("tasks", []):
            if not t.done():
                t.cancel()
        return True
    for job in JOBS.values():
        if job["experiment_id"] == exp_id and job["status"] == "running":
            cancel_job(job["id"])
            return True
    return False


def start_job(params: dict, settings: dict, exp_id: str) -> str:
    _prune()
    job_id = uuid.uuid4().hex[:12]
    cancel = asyncio.Event()
    job = {
        "id": job_id, "experiment_id": exp_id, "status": "running", "created_at": _now(),
        "run_mode": params.get("run_mode", "deep"),
        "panels": {m: {"model": m, "status": "running"} for m in params["models"]},
        "panel_order": list(params["models"]),
        "synthesis": None, "judge_metrics": None, "recommendation": None,
        "totals": None, "overall_status": None, "status_notes": [], "error": None,
        "cancel": cancel, "registry": {}, "task": None,
    }
    JOBS[job_id] = job
    job["task"] = asyncio.create_task(_runner(job, params, settings, exp_id, cancel))
    return job_id


async def _runner(job: dict, params: dict, settings: dict, exp_id: str, cancel: asyncio.Event) -> None:
    try:
        async for ev in run_experiment(params, settings, exp_id, cancel, job["registry"]):
            t = ev["type"]
            if t == "panel_started":
                job["panels"][ev["model"]] = {"model": ev["model"], "status": "running", "cache_hit": ev.get("cache_hit")}
            elif t == "panel_token":
                p = job["panels"].setdefault(ev["model"], {"model": ev["model"], "status": "running"})
                p["partial_output"] = (p.get("partial_output") or "") + ev["text"]
            elif t in ("panel_completed", "panel_error", "panel_skipped"):
                job["panels"][ev["run"]["model"]] = ev["run"]
            elif t == "synthesis":
                job["synthesis"], job["judge_metrics"] = ev["synthesis"], ev["judge_metrics"]
            elif t == "recommendation":
                job["recommendation"] = ev["recommendation"]
            elif t == "done":
                job.update(totals=ev["totals"], overall_status=ev["overall_status"],
                           status_notes=ev["status_notes"], status="completed")
            elif t == "error":
                job.update(error=ev["message"], status="failed")
    except asyncio.CancelledError:
        job.update(status="cancelled", overall_status="cancelled")
    except Exception as e:  # noqa: BLE001
        job.update(status="failed", error=f"{type(e).__name__}: {e}")


def snapshot(job_id: str) -> dict | None:
    job = JOBS.get(job_id)
    if not job:
        return None
    return {k: v for k, v in job.items() if k not in ("cancel", "registry", "task")}


def cancel_job(job_id: str) -> bool:
    job = JOBS.get(job_id)
    if not job or job["status"] != "running":
        return False
    job["cancel"].set()
    for t in job["registry"].get("tasks", []):
        if not t.done():
            t.cancel()
    return True


def _prune() -> None:
    if len(JOBS) <= 50:
        return
    finished = [(jid, j) for jid, j in JOBS.items() if j["status"] != "running"]
    for jid, _ in finished[: len(JOBS) - 50]:
        JOBS.pop(jid, None)