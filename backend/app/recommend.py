"""Recommendation engine: pick (and route to) a best-fit model from real metrics.

Composite score = 0.5*quality + 0.3*cost-efficiency + 0.2*latency-efficiency
(quality from the judge; efficiencies normalized against the best run).
With adaptive escalation ON, a balanced pick below the quality threshold is
escalated to the highest-quality model that clears the threshold.
"""
from .catalog import MODEL_BY_ID


def _label(model_id: str) -> str:
    return MODEL_BY_ID.get(model_id, {}).get("label", model_id)


def _quality_map(ok_runs: list[dict], synthesis: dict | None) -> dict:
    scores = (synthesis or {}).get("scores") or {}
    out = {}
    for r in ok_runs:
        mid = r["model"]
        label = _label(mid)
        s = scores.get(mid) or scores.get(label)
        if s is None:
            s = next((v for k, v in scores.items() if mid in str(k) or label in str(k)), None)
        out[mid] = s.get("quality") if isinstance(s, dict) else None
    return out


def recommend(runs: list[dict], synthesis: dict | None, settings: dict) -> dict | None:
    ok = [r for r in runs if r["status"] == "ok"]
    if not ok:
        return None
    quality = _quality_map(ok, synthesis)
    # Cache hits report ~0ms lookup latency; rank them by the original generation
    # latency so a cached answer doesn't unfairly win the latency term.
    lat = {r["model"]: max(0.001, (r.get("original_latency_ms") or r["latency_ms"]) / 1000) for r in ok}
    cost = {r["model"]: r["est_cost_usd"] for r in ok}
    min_lat, min_cost = min(lat.values()), min(cost.values())

    composite = {}
    for r in ok:
        q = quality[r["model"]]
        ln = min_lat / lat[r["model"]]
        cn = (min_cost / cost[r["model"]]) if cost[r["model"]] > 0 else 1.0
        composite[r["model"]] = (0.5 * (q / 100) + 0.3 * cn + 0.2 * ln) if q is not None else (0.5 * ln + 0.5 * cn)

    best = max(composite, key=composite.get)
    strategy = "Balanced Routing"
    reasons: list[dict] = []
    slo = float(settings.get("latency_slo_s", 2.0))
    thr = int(settings.get("quality_threshold", 80))
    bq = quality[best]

    if settings.get("adaptive_escalation", True) and bq is not None and bq < thr:
        candidates = [r["model"] for r in ok if quality[r["model"]] is not None and quality[r["model"]] >= thr]
        if candidates:
            esc = max(candidates, key=lambda m: quality[m])
            if esc != best:
                reasons.append({"ok": True, "text": f"Balanced pick scored {bq}/100 (below the {thr} threshold); escalated to the highest-quality model that clears it."})
                best, strategy = esc, "Quality Escalation"
                bq = quality[best]

    if lat[best] <= slo:
        reasons.append({"ok": True, "text": f"Matches latency SLO (≤ {slo:g}s) with an estimated {lat[best]:.1f}s."})
    else:
        reasons.append({"ok": False, "text": f"Estimated latency {lat[best]:.1f}s exceeds the {slo:g}s SLO — no selected model met it."})

    pool = [m for m in composite if quality[m] is None or quality[m] >= thr] or list(composite)
    cheapest = min(pool, key=lambda m: cost[m])
    if best == cheapest:
        reasons.append({"ok": True, "text": f"Lowest cost among high-quality options (${cost[best]:.4f} per request)."})
    else:
        rank = sorted(pool, key=lambda m: cost[m]).index(best) + 1
        reasons.append({"ok": True, "text": f"Cost per request ${cost[best]:.4f} (rank {rank} of {len(pool)} among quality ≥ {thr})."})

    if bq is not None:
        rationale = ((synthesis or {}).get("scores") or {}).get(_label(best), {}).get("rationale", "")
        text = f"Judge quality {bq}/100" + (f": {rationale}" if rationale else " with clear, actionable output.")
        reasons.append({"ok": bq >= thr, "text": text})
    else:
        if synthesis is None:
            reasons.append({"ok": False, "text": "Quality not judged (synthesis disabled) — ranking uses latency and cost only."})
        else:
            reasons.append({"ok": False, "text": "Judge quality scores unavailable for this run — ranking uses latency and cost only. Re-run to retry the judge."})

    return {
        "strategy": strategy,
        "model": best,
        "model_label": _label(best),
        "estimated_latency_s": round(lat[best], 2),
        "cost_per_request": round(cost[best], 6),
        "reasons": reasons,
        "composite": {m: round(c, 3) for m, c in composite.items()},
        "quality": quality,
        "confidence": (synthesis or {}).get("overall_confidence", "low"),
    }