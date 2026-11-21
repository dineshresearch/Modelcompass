"""Live inference provider: OpenAI-compatible HTTP against DigitalOcean inference."""
import httpx

from . import config


class InferenceError(Exception):
    pass


async def live_call(model_id: str, prompt: str, max_tokens: int, system: str | None = None) -> dict:
    """Single non-streaming chat completion against the configured endpoint."""
    if not config.INFERENCE_API_KEY:
        raise InferenceError("No INFERENCE_API_KEY configured (backend/.env)")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model_id, "messages": messages, "max_tokens": max_tokens, "stream": False}
    headers = {
        "Authorization": f"Bearer {config.INFERENCE_API_KEY}",
        "Content-Type": "application/json",
    }
    # trust_env=False: ignore OS proxy env vars. A bracketed IPv6 entry in NO_PROXY
    # (e.g. "[::1]") makes httpx's proxy-mount URL parsing raise InvalidURL.
    async with httpx.AsyncClient(timeout=config.REQUEST_TIMEOUT_S, trust_env=False) as client:
        resp = await client.post(f"{config.INFERENCE_BASE_URL}/chat/completions", json=payload, headers=headers)
    if resp.status_code != 200:
        raise InferenceError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        msg = data["choices"][0]["message"] or {}
        text = msg.get("content") or ""
    except (KeyError, IndexError, TypeError):
        raise InferenceError(f"Unexpected response shape: {str(data)[:200]}")
    if not text.strip():
        hint = " (model spent max_tokens on reasoning; raise max_tokens)" if msg.get("reasoning_content") else ""
        raise InferenceError(f"Empty final content{hint}")
    usage = data.get("usage") or {}
    input_tokens = usage.get("prompt_tokens")
    output_tokens = usage.get("completion_tokens")
    estimated = not (input_tokens and output_tokens)
    # Heuristic fallback (~4 chars/token), clearly flagged so metrics stay honest.
    input_tokens = int(input_tokens or max(1, len(prompt) // 4))
    output_tokens = int(output_tokens or max(1, len(text) // 4))
    return {
        "output": text,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "tokens_estimated": estimated,
    }