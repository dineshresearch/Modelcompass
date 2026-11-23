"""Live inference provider: OpenAI-compatible HTTP against DigitalOcean inference.

Streaming-first (verified on all four catalog models): SSE deltas with usage in
the final chunk. Falls back to a non-streaming call if upstream rejects stream.
Reasoning suppression uses per-model knobs verified live (catalog.REASONING_OFF).
"""
import json

import httpx

from . import config
from .catalog import REASONING_OFF


class InferenceError(Exception):
    def __init__(self, message: str, kind: str = "failed", status_code: int | None = None, usage: dict | None = None):
        super().__init__(message)
        self.kind = kind  # ok | timeout | rate_limited | failed
        self.status_code = status_code
        self.usage = usage  # upstream usage when available (e.g. empty-content failures still burn tokens)


def _http_error(status: int, text: str) -> InferenceError:
    if status == 429:
        kind = "rate_limited"
    elif status in (408, 504):
        kind = "timeout"
    else:
        kind = "failed"
    return InferenceError(f"HTTP {status}: {text[:300]}", kind=kind, status_code=status)


def _payload(model_id: str, prompt: str, max_tokens: int, system: str | None, reasoning: bool, stream: bool) -> dict:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model_id, "messages": messages, "max_tokens": max_tokens, "stream": stream}
    if stream:
        payload["stream_options"] = {"include_usage": True}
    if not reasoning:
        payload.update(REASONING_OFF.get(model_id, {}).get("payload", {}))
    return payload


def _headers() -> dict:
    return {"Authorization": f"Bearer {config.INFERENCE_API_KEY}", "Content-Type": "application/json"}


def _usage_fields(usage: dict, prompt: str, text: str) -> dict:
    input_tokens = usage.get("prompt_tokens")
    output_tokens = usage.get("completion_tokens")
    estimated = not (input_tokens and output_tokens)
    # Heuristic fallback (~4 chars/token), clearly flagged so metrics stay honest.
    input_tokens = int(input_tokens or max(1, len(prompt) // 4))
    output_tokens = int(output_tokens or max(1, len(text) // 4))
    details = usage.get("completion_tokens_details") or {}
    prompt_details = usage.get("prompt_tokens_details") or {}
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "tokens_estimated": estimated,
        "reasoning_tokens": details.get("reasoning_tokens"),
        "upstream_cached_tokens": prompt_details.get("cached_tokens") or 0,
    }


async def live_call(
    model_id: str,
    prompt: str,
    max_tokens: int,
    system: str | None = None,
    reasoning: bool = True,
    on_token=None,
    cancel_event=None,
) -> dict:
    """One chat completion. Streams content deltas to on_token(text) when provided.

    Never returns empty content silently: raises InferenceError("Empty final
    content...") so the orchestrator can apply the visible 2x-budget retry.
    """
    if not config.INFERENCE_API_KEY:
        raise InferenceError("No INFERENCE_API_KEY configured (backend/.env)")
    # trust_env=False: ignore OS proxy env vars. A bracketed IPv6 entry in NO_PROXY
    # (e.g. "[::1]") makes httpx's proxy-mount URL parsing raise InvalidURL.
    async with httpx.AsyncClient(timeout=config.REQUEST_TIMEOUT_S, trust_env=False) as client:
        try:
            return await _stream_call(client, model_id, prompt, max_tokens, system, reasoning, on_token, cancel_event)
        except InferenceError as e:
            # Async fallback: upstream rejected streaming -> one non-streaming call.
            if e.status_code in (400, 404, 422) and "stream" in str(e).lower():
                return await _plain_call(client, model_id, prompt, max_tokens, system, reasoning)
            raise


async def _stream_call(client, model_id, prompt, max_tokens, system, reasoning, on_token, cancel_event) -> dict:
    payload = _payload(model_id, prompt, max_tokens, system, reasoning, stream=True)
    content, reasoning_chars = "", 0
    usage = {}
    finish = None
    async with client.stream("POST", f"{config.INFERENCE_BASE_URL}/chat/completions", json=payload, headers=_headers()) as resp:
        if resp.status_code != 200:
            body = (await resp.aread()).decode(errors="replace")
            raise _http_error(resp.status_code, body)
        async for line in resp.aiter_lines():
            if cancel_event is not None and cancel_event.is_set():
                raise InferenceError("Cancelled by user", kind="cancelled")
            if not line.startswith("data: "):
                continue
            data = line[6:].strip()
            if data == "[DONE]":
                break
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue
            if obj.get("usage"):
                usage = obj["usage"]
            for ch in obj.get("choices") or []:
                delta = ch.get("delta") or {}
                piece = delta.get("content") or ""
                if piece:
                    content += piece
                    if on_token is not None:
                        on_token(piece)
                reasoning_chars += len(delta.get("reasoning_content") or "")
                if ch.get("finish_reason"):
                    finish = ch["finish_reason"]
    if not content.strip():
        hint = " (model spent max_tokens on reasoning; raise max_tokens)" if reasoning_chars else ""
        raise InferenceError(f"Empty final content{hint}", usage=usage)
    out = {"output": content, "streamed": True, "finish_reason": finish, "reasoning_chars": reasoning_chars}
    out.update(_usage_fields(usage, prompt, content))
    return out


async def _plain_call(client, model_id, prompt, max_tokens, system, reasoning) -> dict:
    payload = _payload(model_id, prompt, max_tokens, system, reasoning, stream=False)
    resp = await client.post(f"{config.INFERENCE_BASE_URL}/chat/completions", json=payload, headers=_headers())
    if resp.status_code != 200:
        raise _http_error(resp.status_code, resp.text)
    data = resp.json()
    try:
        msg = data["choices"][0]["message"] or {}
        text = msg.get("content") or ""
    except (KeyError, IndexError, TypeError):
        raise InferenceError(f"Unexpected response shape: {str(data)[:200]}")
    if not text.strip():
        hint = " (model spent max_tokens on reasoning; raise max_tokens)" if msg.get("reasoning_content") else ""
        raise InferenceError(f"Empty final content{hint}", usage=data.get("usage") or {})
    out = {"output": text, "streamed": False, "finish_reason": (data["choices"][0].get("finish_reason")),
           "reasoning_chars": len(msg.get("reasoning_content") or "")}
    out.update(_usage_fields(data.get("usage") or {}, prompt, text))
    return out