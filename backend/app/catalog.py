"""Model catalog for the DigitalOcean inference endpoint (inference.do-ai.run).

These four models were verified against the live endpoint with the project's
API key (HTTP 200 on chat/completions). OpenAI/Anthropic catalog entries exist
but return 403 "not available for your subscription tier" on this key's plan.

Pricing is ILLUSTRATIVE placeholder data — real rates are unknown.
In production this table would be sourced from the DigitalOcean Model Catalog.
"""

MODELS = [
    {
        "id": "deepseek-v4.1-flash",
        "label": "DeepSeek V4.1 Flash",
        "vendor": "DeepSeek",
        "color": "#2563eb",
        "input_usd_per_m": 0.15,
        "output_usd_per_m": 0.60,
        "blurb": "Fast reasoning model",
    },
    {
        "id": "glm-5.3-flash",
        "label": "GLM 5.3 Flash",
        "vendor": "Zai-org",
        "color": "#16a34a",
        "input_usd_per_m": 0.10,
        "output_usd_per_m": 0.40,
        "blurb": "Lightweight low-latency model (default synthesis judge)",
    },
    {
        "id": "minimax-m2.5",
        "label": "MiniMax M2.5",
        "vendor": "MiniMax",
        "color": "#d97706",
        "input_usd_per_m": 0.30,
        "output_usd_per_m": 1.20,
        "blurb": "General-purpose reasoning model",
    },
    {
        "id": "kimi-k2.6",
        "label": "Kimi K2.6",
        "vendor": "Moonshot",
        "color": "#7c3aed",
        "input_usd_per_m": 0.20,
        "output_usd_per_m": 0.80,
        "blurb": "Long-context chat model",
    },
]

MODEL_BY_ID = {m["id"]: m for m in MODELS}

# Verified live (2026-11-22): payload knobs that suppress reasoning tokens.
# "full" = reasoning_tokens drops to ~0; "partial" = upstream only reduces reasoning
# (MiniMax M2.5 has no full off switch on this endpoint) — labeled honestly in the UI.
REASONING_OFF = {
    "deepseek-v4.1-flash": {"payload": {"reasoning_effort": "none"}, "effect": "full"},
    "glm-5.3-flash": {"payload": {"reasoning_effort": "none"}, "effect": "full"},
    "minimax-m2.5": {"payload": {"thinking": {"type": "disabled"}}, "effect": "partial"},
    "kimi-k2.6": {"payload": {"reasoning_effort": "none"}, "effect": "full"},
}
for _m in MODELS:
    _m["reasoning_off_effect"] = REASONING_OFF[_m["id"]]["effect"]

PRICING_NOTE = (
    "Illustrative placeholder pricing ($/million tokens). "
    "Replace with DigitalOcean Model Catalog rates before any real cost analysis."
)


def est_cost_usd(model_id: str, input_tokens: int, output_tokens: int) -> float:
    m = MODEL_BY_ID.get(model_id)
    if not m:
        return 0.0
    return (input_tokens * m["input_usd_per_m"] + output_tokens * m["output_usd_per_m"]) / 1_000_000