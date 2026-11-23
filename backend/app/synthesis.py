"""Comparison & evaluation engine.

Contract: the synthesis NEVER merges or rewrites the original answers. It is a
separate, clearly-labeled judge artifact with explicit uncertainty. Originals
are always preserved and displayed independently. The judge also scores each
answer's quality (0-100), which feeds the recommendation engine.
"""
import json
import re
import time

from .catalog import MODEL_BY_ID, est_cost_usd
from .providers import live_call

JUDGE_SYSTEM = """You are an impartial model-comparison judge. You receive a user prompt and labeled answers from different models.

Rules:
- NEVER merge the answers into one. NEVER rewrite or "fix" them.
- Score each answer's quality from 0 to 100 for how well it answers the user prompt (accuracy, completeness, clarity, actionability). Give a rationale of at most 25 words per model.
- Identify concrete agreements, concrete differences (attribute each position to its model label), and possible weaknesses or factual errors per model.
- Be explicit about uncertainty: if you cannot verify a claim, say so. Do not present your own opinion as fact.
- Respond with ONLY a JSON object (no markdown fences, no prose before or after) matching exactly this schema:
{"scores": {model_label: {"quality": integer, "rationale": string}}, "agreements": [string], "differences": [{"topic": string, "positions": {model_label: string}}], "weaknesses": [{"model": string, "issue": string, "confidence": "low"|"medium"|"high"}], "uncertainty_notes": [string], "overall_confidence": "low"|"medium"|"high"}
- "scores" MUST come first and include every model label. Keep every other string under 40 words and each list to 2-4 items. Keep the whole JSON compact (under ~1500 tokens)."""


def _build_judge_prompt(prompt: str, ok_runs: list[dict], excerpt: int = 2500) -> str:
    parts = [f"USER PROMPT:\n{prompt}\n"]
    for r in ok_runs:
        label = MODEL_BY_ID.get(r["model"], {}).get("label", r["model"])
        parts.append(f"=== ANSWER FROM {label} ({r['model']}) ===\n{r['output'][:excerpt]}\n")
    parts.append("Produce the JSON comparison now. Remember: scores first, compact JSON only.")
    return "\n".join(parts)


def _repair_truncated_json(text: str) -> str:
    """Best-effort recovery of JSON cut off mid-stream (e.g. judge hit its token cap).

    Closes any open string and any unclosed braces/brackets so the leading
    fields (scores come first) can still be parsed.
    """
    stack: list[str] = []
    in_str = False
    esc = False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if stack:
                stack.pop()
    out = text
    if in_str:
        out += '"'
    out = out.rstrip()
    if out.endswith(":"):
        out += "null"
    while stack:
        out = out.rstrip().rstrip(",")
        if out.endswith(":"):
            out += "null"
        ch = stack.pop()
        out += "}" if ch == "{" else "]"
    return out


def _parse_judge_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Judge returned no JSON object")
    obj = json.loads(text[start : end + 1])
    scores = {}
    for label, s in (obj.get("scores") or {}).items():
        if isinstance(s, dict):
            try:
                q = max(0, min(100, int(s.get("quality", 0))))
            except (TypeError, ValueError):
                continue
            scores[str(label)] = {"quality": q, "rationale": str(s.get("rationale", ""))[:300]}
    out = {
        "agreements": [str(x) for x in obj.get("agreements", [])][:6],
        "differences": obj.get("differences", [])[:6],
        "weaknesses": obj.get("weaknesses", [])[:6],
        "uncertainty_notes": [str(x) for x in obj.get("uncertainty_notes", [])][:6],
        "overall_confidence": obj.get("overall_confidence", "low"),
        "scores": scores,
    }
    if out["overall_confidence"] not in ("low", "medium", "high"):
        out["overall_confidence"] = "low"
    return out


def _try_parse(text: str) -> tuple[dict | None, str | None]:
    """Parse judge output; on failure, attempt truncation repair. (None, error) if unusable."""
    err = None
    for candidate in (text, _repair_truncated_json(text)):
        try:
            obj = _parse_judge_json(candidate)
        except (ValueError, json.JSONDecodeError) as e:
            err = str(e)
            continue
        if obj.get("scores"):  # need at least one quality score to be useful
            return obj, None
        err = "JSON parsed but contained no quality scores"
    return None, err


def _canonical_scores(raw: dict, ok_runs: list[dict]) -> dict:
    """Re-key judge scores to model ids. The judge echoes labels in varying
    formats ('Label', 'Label (id)'); matching by id/label substring keeps
    recommendation, UI and quality history lookups deterministic."""
    out = {}
    for r in ok_runs:
        mid = r["model"]
        label = MODEL_BY_ID.get(mid, {}).get("label", mid)
        hit = raw.get(mid) or raw.get(label)
        if hit is None:
            for k, v in raw.items():
                if mid in str(k) or str(k) in label or label in str(k):
                    hit = v
                    break
        if isinstance(hit, dict):
            out[mid] = hit
    return out


async def synthesize_live(prompt: str, ok_runs: list[dict], judge_model: str) -> tuple[dict, dict]:
    """LLM-as-judge via one catalog model. Returns (synthesis, judge_metrics).

    Reliability: scores-first schema + 8192-token budget + truncation repair +
    one compact retry. If the judge still fails, a clearly-labeled heuristic
    fallback is returned (no quality scores — never fabricated).
    """
    t0 = time.perf_counter()
    res = await live_call(judge_model, _build_judge_prompt(prompt, ok_runs), max_tokens=8192, system=JUDGE_SYSTEM)
    total_in, total_out = res["input_tokens"], res["output_tokens"]
    estimated = res["tokens_estimated"]
    retried = False

    synthesis, parse_error = _try_parse(res["output"])
    if synthesis is None:
        # One retry with shorter excerpts to leave more room for the JSON.
        retried = True
        res2 = await live_call(judge_model, _build_judge_prompt(prompt, ok_runs, excerpt=1200), max_tokens=8192, system=JUDGE_SYSTEM)
        total_in += res2["input_tokens"]
        total_out += res2["output_tokens"]
        estimated = estimated or res2["tokens_estimated"]
        synthesis, err2 = _try_parse(res2["output"])
        parse_error = err2 or parse_error

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    if synthesis is not None:
        synthesis["scores"] = _canonical_scores(synthesis.get("scores") or {}, ok_runs)
        synthesis["judge_model"] = judge_model
        synthesis["generated"] = True
        synthesis["fallback"] = False
    else:
        synthesis = heuristic_synthesis(
            ok_runs,
            note="Judge output was not valid JSON (likely truncated at the token cap); showing heuristic comparison instead. Re-run the comparison to retry the judge.",
        )
        synthesis["judge_error"] = parse_error or "unknown parse failure"
        synthesis["fallback"] = True
        # keep heuristic labeling: judge_model='heuristic-fallback', generated=False
    metrics = {
        "judge_model": judge_model,
        "latency_ms": latency_ms,
        "input_tokens": total_in,
        "output_tokens": total_out,
        "tokens_estimated": estimated,
        "est_cost_usd": round(est_cost_usd(judge_model, total_in, total_out), 6),
        "retried": retried,
    }
    return synthesis, metrics


def heuristic_synthesis(ok_runs: list[dict], note: str = "") -> dict:
    """Deterministic, cheap fallback — surface-level signals only, no semantic claims."""
    def words(t: str) -> set[str]:
        return set(re.findall(r"[a-z0-9']+", t.lower()))

    sets = {r["model"]: words(r["output"]) for r in ok_runs}
    labels = {m: MODEL_BY_ID.get(m, {}).get("label", m) for m in sets}
    overlaps = []
    models = list(sets)
    for i in range(len(models)):
        for j in range(i + 1, len(models)):
            a, b = sets[models[i]], sets[models[j]]
            jac = len(a & b) / len(a | b) if a | b else 0.0
            overlaps.append(f"{labels[models[i]]} vs {labels[models[j]]}: {jac:.0%} word overlap (Jaccard)")
    lengths = ", ".join(f"{labels[m]} {len(r['output'].split())} words" for m, r in zip(models, ok_runs))
    notes = ["Heuristic comparison only — no semantic judge was run; overlap is lexical, not factual agreement."]
    if note:
        notes.insert(0, note)
    return {
        "agreements": [],
        "differences": [{"topic": "Lexical overlap", "positions": {"pairwise": "; ".join(overlaps)}}] if overlaps else [],
        "weaknesses": [],
        "uncertainty_notes": notes + [f"Answer lengths: {lengths}."],
        "overall_confidence": "low",
        "scores": {},
        "judge_model": "heuristic-fallback",
        "generated": False,
    }