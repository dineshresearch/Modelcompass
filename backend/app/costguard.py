"""Cost guard: pre-run estimates, per-request budget reservations, budget-aware
panel suggestions, and per-user daily/monthly spend caps with alert levels.

Estimates are worst-case (token caps), explicitly labeled — never presented as
actuals. Actuals come from real API usage after the run (honest metering).
"""
from . import store
from .catalog import MODEL_BY_ID, est_cost_usd

JUDGE_MAX_TOKENS = 8192
JUDGE_SYSTEM_TOKENS_EST = 300
JUDGE_EXCERPT_CHARS = 2500  # matches synthesis._build_judge_prompt excerpt cap


class SpendCapError(Exception):
    pass


def tokens_est(text: str) -> int:
    return max(1, len(text) // 4)


def estimate_run(models: list[str], prompt: str, max_tokens: int, synthesize: bool, judge_model: str) -> dict:
    in_tok = tokens_est(prompt)
    per_model = []
    for mid in models:
        m = MODEL_BY_ID.get(mid)
        if not m:
            continue
        cost = est_cost_usd(mid, in_tok, max_tokens)
        per_model.append({
            "model": mid,
            "label": m["label"],
            "input_tokens_est": in_tok,
            "output_tokens_cap": max_tokens,
            "est_cost_usd": round(cost, 6),
        })
    judge = None
    if synthesize and len(models) >= 2:
        judge_in = in_tok + JUDGE_SYSTEM_TOKENS_EST + len(models) * (JUDGE_EXCERPT_CHARS // 4)
        judge = {
            "model": judge_model,
            "label": MODEL_BY_ID.get(judge_model, {}).get("label", judge_model),
            "input_tokens_est": judge_in,
            "output_tokens_cap": JUDGE_MAX_TOKENS,
            "est_cost_usd": round(est_cost_usd(judge_model, judge_in, JUDGE_MAX_TOKENS), 6),
        }
    total = sum(p["est_cost_usd"] for p in per_model) + (judge["est_cost_usd"] if judge else 0.0)
    return {
        "per_model": per_model,
        "judge": judge,
        "total_usd": round(total, 6),
        "basis": "Worst-case estimate at full token caps; actual spend is usually lower. Illustrative placeholder pricing.",
    }


class BudgetGuard:
    """Per-request cap with reservation accounting: panels reserve their worst-case
    estimate before launching; actuals are committed on completion. When the cap
    cannot fit the next panel, it is skipped (labeled partial), never overspent."""

    def __init__(self, cap_usd: float | None):
        self.cap = cap_usd if cap_usd and cap_usd > 0 else None
        self.spent = 0.0
        self.reserved = 0.0

    def try_reserve(self, est_usd: float) -> bool:
        if self.cap is None:
            return True
        if self.spent + self.reserved + est_usd <= self.cap + 1e-9:
            self.reserved += est_usd
            return True
        return False

    def commit(self, actual_usd: float, est_usd: float) -> None:
        self.reserved = max(0.0, self.reserved - est_usd)
        self.spent += actual_usd

    def release(self, est_usd: float) -> None:
        self.reserved = max(0.0, self.reserved - est_usd)

    @property
    def remaining(self) -> float | None:
        return None if self.cap is None else max(0.0, self.cap - self.spent - self.reserved)


def suggest_panel(budget_usd: float, max_tokens: int, synthesize: bool, judge_model: str, quality_floor: int) -> dict:
    """Cheapest model subset (>=2) whose worst-case estimate fits the budget and
    whose historical judge quality clears the floor. Routine default: two models."""
    qual = store.model_quality()
    ranked = sorted(MODEL_BY_ID, key=lambda mid: est_cost_usd(mid, 1000, max_tokens))
    eligible, notes = [], []
    for mid in ranked:
        q = qual.get(mid)
        if q is None:
            eligible.append(mid)
            notes.append(f"{MODEL_BY_ID[mid]['label']}: no judge history yet — included provisionally.")
        elif q["avg_quality"] >= quality_floor:
            eligible.append(mid)
        else:
            notes.append(f"{MODEL_BY_ID[mid]['label']}: historical quality {q['avg_quality']}/100 is below the {quality_floor} floor — excluded.")
    if len(eligible) < 2:
        eligible = ranked[:2]
        notes.append("Fewer than two models clear the quality floor; falling back to the two cheapest.")
    for k in range(2, len(eligible) + 1):
        subset = eligible[:k]
        est = estimate_run(subset, "x" * 400, max_tokens, synthesize, judge_model)
        if est["total_usd"] <= budget_usd:
            return {
                "models": subset, "est_total_usd": est["total_usd"], "fits_budget": True,
                "quality_floor": quality_floor, "notes": notes,
                "rationale": f"Cheapest {k}-model panel clearing the {quality_floor}/100 quality floor within ${budget_usd:.4f}.",
            }
    subset = eligible[:2]
    est = estimate_run(subset, "x" * 400, max_tokens, synthesize, judge_model)
    return {
        "models": subset, "est_total_usd": est["total_usd"], "fits_budget": False,
        "quality_floor": quality_floor, "notes": notes,
        "rationale": f"No panel fits ${budget_usd:.4f} at worst-case caps; returning the two cheapest. Actual spend may still fit — or lower max tokens / drop the judge.",
    }


def check_spend_caps(estimate_total_usd: float) -> None:
    """Block a run whose worst-case estimate would breach a configured daily/monthly cap."""
    s = store.spend_summary()
    for period, label in (("day", "Daily"), ("month", "Monthly")):
        p = s[period]
        cap = p["cap_usd"]
        if cap > 0 and p["spend_usd"] + estimate_total_usd > cap + 1e-9:
            raise SpendCapError(
                f"{label} spend cap ${cap:.4f}: ${p['spend_usd']:.4f} already spent; this run's worst-case "
                f"estimate ${estimate_total_usd:.4f} exceeds the remaining ${p['remaining_usd']:.4f}. "
                f"Shrink the panel, lower max tokens, or raise the cap in Settings."
            )