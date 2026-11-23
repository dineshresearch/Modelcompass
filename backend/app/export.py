"""Export renderers: full experiment as JSON or a Markdown report."""
import json

from .catalog import MODEL_BY_ID


def render_json(exp: dict) -> str:
    return json.dumps(exp, indent=2, ensure_ascii=False)


def _label(model_id: str) -> str:
    return MODEL_BY_ID.get(model_id, {}).get("label", model_id)


def render_markdown(exp: dict) -> str:
    lines = [
        "# Model Compass — comparison report",
        "",
        f"- **Experiment:** `{exp['id']}`",
        f"- **Date:** {exp['created_at']}",
        f"- **Mode:** {exp['mode']} · run mode: {exp.get('run_mode') or 'custom'}",
        f"- **Overall status:** {exp.get('overall_status') or 'ok'}"
        + (f" · budget cap ${exp['budget_usd']:.4f}" if exp.get("budget_usd") else ""),
        f"- **Total estimated cost:** ${exp.get('total_cost_usd', 0):.6f} (illustrative pricing)",
        "",
    ]
    if exp.get("status_notes"):
        lines += ["## Status notes", ""] + [f"- {n}" for n in exp["status_notes"]] + [""]
    lines += [
        "## Prompt",
        "",
        exp["prompt"],
        "",
        "## Responses",
    ]
    for r in exp.get("runs", []):
        lines += ["", f"### {_label(r['model'])} — {r['status']}", ""]
        if r["status"] == "ok":
            est = " (estimated)" if r.get("tokens_estimated") else ""
            badges = []
            if r.get("cache_hit"):
                badges.append(f"cache hit: {r['cache_hit']}" + (f" (similarity {r['cache_similarity']})" if r.get("cache_similarity") else "") + f", generated {r.get('cached_at', '?')}")
            if r.get("retried"):
                badges.append("auto-retried")
            if not r.get("reasoning", True):
                badges.append("reasoning off")
            if r.get("upstream_cached_tokens"):
                badges.append(f"upstream prefix cache: {r['upstream_cached_tokens']} tokens")
            lines += [
                f"*Latency {r['latency_ms']:.0f} ms · {r['input_tokens']} in / {r['output_tokens']} out tokens{est} · est. ${r['est_cost_usd']:.6f}*",
            ]
            if badges:
                lines += ["", "*" + " · ".join(badges) + "*"]
            lines += ["", r["output"] or ""]
        else:
            lines += [f"**Error ({r.get('error_kind') or r['status']}):** {r['error']}"]
            if r.get("output_tokens"):
                lines += ["", f"*Burned upstream tokens: {r.get('input_tokens', 0)} in / {r['output_tokens']} out (est. ${r.get('est_cost_usd', 0):.6f}); auto-retried: {bool(r.get('retried'))}.*"]
    syn = exp.get("synthesis")
    if syn:
        lines += ["", "## Synthesis", "",
                  f"*Judge: {syn.get('judge_model', 'unknown')} · overall confidence: {syn.get('overall_confidence', 'low')}.*",
                  "", "> Synthesis is a separate judge artifact. Original answers above are preserved unaltered."]
        if syn.get("agreements"):
            lines += ["", "### Agreements", ""] + [f"- {a}" for a in syn["agreements"]]
        if syn.get("differences"):
            lines += ["", "### Differences", ""]
            for d in syn["differences"]:
                lines.append(f"- **{d.get('topic', 'Topic')}**")
                for model, pos in (d.get("positions") or {}).items():
                    lines.append(f"  - {model}: {pos}")
        if syn.get("weaknesses"):
            lines += ["", "### Possible weaknesses", ""]
            for w in syn["weaknesses"]:
                lines.append(f"- **{w.get('model', '?')}** ({w.get('confidence', 'low')} confidence): {w.get('issue', '')}")
        if syn.get("uncertainty_notes"):
            lines += ["", "### Uncertainty", ""] + [f"- {u}" for u in syn["uncertainty_notes"]]
    rec = exp.get("recommendation")
    if rec:
        lines += ["", "## Recommendation", "",
                  f"- **Strategy:** {rec.get('strategy', '')}",
                  f"- **Best fit:** {rec.get('model_label', rec.get('model', ''))}",
                  f"- **Estimated latency:** {rec.get('estimated_latency_s', 0)}s · **cost/request:** ${rec.get('cost_per_request', 0):.6f}",
                  "", "### Why"] + [f"- {'[ok]' if r.get('ok') else '[warn]'} {r.get('text', '')}" for r in rec.get("reasons", [])]
    if exp.get("preferred_model"):
        lines += ["", "## User preference", "",
                  f"- **Preferred:** {_label(exp['preferred_model'])}",
                  f"- **Reason:** {exp.get('preference_reason') or '(none given)'}",
                  f"- **Recorded:** {exp.get('preferred_at', '')}"]
    lines.append("")
    return "\n".join(lines)