"""Model Compass — FastAPI orchestration service (live-only PoC)."""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

from . import config, store
from .catalog import MODELS, MODEL_BY_ID, PRICING_NOTE
from .export import render_json, render_markdown
from .orchestrator import make_tasks
from .providers import live_call
from .recommend import recommend
from .schemas import CompareRequest, PreferenceRequest, SettingsUpdate
from .synthesis import heuristic_synthesis, synthesize_live

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("compass")

app = FastAPI(title="Model Compass PoC", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    store.init_db()
    log.info("Model Compass backend up — mode=%s base_url=%s", config.MODE, config.INFERENCE_BASE_URL)


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "mode": config.MODE,
        "live_configured": bool(config.INFERENCE_API_KEY),
        "base_url": config.INFERENCE_BASE_URL,
        "n_models": len(MODELS),
    }


@app.get("/api/models")
def models() -> dict:
    return {"models": MODELS, "pricing_note": PRICING_NOTE, "mode": config.MODE}


@app.get("/api/settings")
def get_settings() -> dict:
    return store.get_settings()


@app.put("/api/settings")
def put_settings(req: SettingsUpdate) -> dict:
    updates = req.model_dump(exclude_none=True)
    if "judge_model" in updates and updates["judge_model"] not in MODEL_BY_ID:
        raise HTTPException(400, "judge_model must be one of the catalog models")
    return store.put_settings(updates)


@app.post("/api/test-connection")
async def test_connection() -> dict:
    if not config.INFERENCE_API_KEY:
        return {"ok": False, "message": "No INFERENCE_API_KEY configured in backend/.env"}
    judge = store.get_settings()["judge_model"]
    t0 = time.perf_counter()
    try:
        res = await asyncio.wait_for(live_call(judge, "Reply with exactly: OK", max_tokens=512), timeout=60)
        return {
            "ok": True,
            "model": judge,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "reply": res["output"][:80],
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"{type(e).__name__}: {e}"}


@app.post("/api/compare")
async def compare(req: CompareRequest):
    """Parallel comparison, streamed as SSE: run events → synthesis → recommendation → done."""
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(400, "Prompt is empty")
    if len(prompt) > config.MAX_PROMPT_CHARS:
        raise HTTPException(400, f"Prompt exceeds {config.MAX_PROMPT_CHARS} characters")
    if not (config.MIN_MODELS <= len(req.models) <= config.MAX_MODELS):
        raise HTTPException(400, f"Select between {config.MIN_MODELS} and {config.MAX_MODELS} models")
    unknown = [m for m in req.models if m not in MODEL_BY_ID]
    if unknown:
        raise HTTPException(400, f"Unknown models: {unknown}")
    if len(set(req.models)) != len(req.models):
        raise HTTPException(400, "Duplicate models selected")
    if not config.INFERENCE_API_KEY:
        raise HTTPException(400, "No INFERENCE_API_KEY configured in backend/.env")
    settings = store.get_settings()
    max_tokens = min(req.max_tokens, config.MAX_TOKENS_CAP)

    async def event_stream():
        exp_id = uuid.uuid4().hex[:12]
        started = time.perf_counter()
        log.info("experiment=%s models=%s", exp_id, req.models)
        try:
            tasks = make_tasks(req.models, prompt, max_tokens)
            runs: list[dict] = []
            for fut in asyncio.as_completed(tasks):
                run = await fut
                runs.append(run)
                log.info("experiment=%s model=%s status=%s latency_ms=%s", exp_id, run["model"], run["status"], run["latency_ms"])
                yield _sse({"type": "run", "run": run})
            runs.sort(key=lambda r: req.models.index(r["model"]))

            synthesis, judge_metrics = None, None
            ok_runs = [r for r in runs if r["status"] == "ok"]
            if req.synthesize and len(ok_runs) >= 2:
                try:
                    synthesis, judge_metrics = await synthesize_live(prompt, ok_runs, settings["judge_model"])
                except Exception as e:  # noqa: BLE001 — synthesis failure must not lose the runs
                    log.warning("experiment=%s synthesis failed: %s", exp_id, e)
                    synthesis = heuristic_synthesis(ok_runs, note=f"Synthesis judge failed ({type(e).__name__}); showing heuristic comparison.")
                    judge_metrics = None
                yield _sse({"type": "synthesis", "synthesis": synthesis, "judge_metrics": judge_metrics})

            rec = recommend(runs, synthesis, settings)
            if rec:
                yield _sse({"type": "recommendation", "recommendation": rec})

            total_cost = sum(r["est_cost_usd"] for r in runs) + (judge_metrics or {}).get("est_cost_usd", 0.0)
            exp = {
                "id": exp_id,
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "mode": config.MODE,
                "prompt": prompt,
                "max_tokens": max_tokens,
                "synthesis": synthesis,
                "judge_metrics": judge_metrics,
                "recommendation": rec,
                "total_cost_usd": round(total_cost, 6),
                "total_latency_ms": round((time.perf_counter() - started) * 1000, 1),
            }
            await asyncio.to_thread(store.save_experiment, exp, runs)
            yield _sse({
                "type": "done",
                "experiment_id": exp_id,
                "totals": {
                    "cost_usd": round(total_cost, 6),
                    "wall_latency_ms": exp["total_latency_ms"],
                    "models_ok": len(ok_runs),
                    "models_failed": len(runs) - len(ok_runs),
                },
            })
        except Exception as e:  # noqa: BLE001
            log.exception("experiment=%s stream error", exp_id)
            yield _sse({"type": "error", "message": f"{type(e).__name__}: {e}"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/experiments")
def experiments(limit: int = 50) -> dict:
    return {"experiments": store.list_experiments(min(limit, 200))}


@app.get("/api/experiments/{exp_id}")
def experiment(exp_id: str) -> dict:
    exp = store.get_experiment(exp_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")
    return exp


@app.post("/api/experiments/{exp_id}/preference")
def preference(exp_id: str, req: PreferenceRequest) -> dict:
    if not store.get_experiment(exp_id):
        raise HTTPException(404, "Experiment not found")
    try:
        exp = store.set_preference(exp_id, req.model, req.reason.strip()[:2000])
    except ValueError as e:
        raise HTTPException(400, str(e))
    if exp is None:
        raise HTTPException(400, "Preferred model was not part of this experiment")
    log.info("experiment=%s preference=%s", exp_id, req.model)
    return {"ok": True, "experiment": exp}


@app.post("/api/experiments/{exp_id}/recommend")
def recompute_recommendation(exp_id: str) -> dict:
    """Re-run the recommendation engine with current settings (e.g. escalation toggle)."""
    exp = store.get_experiment(exp_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")
    rec = recommend(exp["runs"], exp["synthesis"], store.get_settings())
    store.set_recommendation(exp_id, rec)
    return {"recommendation": rec}


@app.get("/api/experiments/{exp_id}/export")
def export(exp_id: str, format: str = "json"):
    exp = store.get_experiment(exp_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")
    if format == "md":
        body, media, ext = render_markdown(exp), "text/markdown; charset=utf-8", "md"
    elif format == "json":
        body, media, ext = render_json(exp), "application/json", "json"
    else:
        raise HTTPException(400, "format must be json or md")
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="model-compass-{exp_id}.{ext}"'},
    )


@app.get("/api/stats")
def stats() -> dict:
    return store.stats()