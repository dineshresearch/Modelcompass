from pydantic import BaseModel, Field


class CompareRequest(BaseModel):
    prompt: str
    models: list[str]
    max_tokens: int = Field(default=4096, ge=16, le=8192)
    synthesize: bool = True
    mode: str = Field(default="fast", pattern="^(fast|balanced|deep|custom)$")
    budget_usd: float | None = Field(default=None, gt=0, le=1000)
    reasoning: bool = True
    reasoning_overrides: dict[str, bool] = Field(default_factory=dict)
    refresh: bool = False  # bypass the answer cache (freshness-sensitive queries)
    async_mode: bool = False  # job_id + polling instead of SSE (Deep forces this)


class PreferenceRequest(BaseModel):
    model: str
    reason: str = ""


class SettingsUpdate(BaseModel):
    latency_slo_s: float | None = Field(default=None, gt=0, le=120)
    quality_threshold: int | None = Field(default=None, ge=0, le=100)
    adaptive_escalation: bool | None = None
    max_tokens: int | None = Field(default=None, ge=16, le=8192)
    synthesize: bool | None = None
    judge_model: str | None = None
    cache_enabled: bool | None = None
    cache_ttl_s: int | None = Field(default=None, ge=0, le=86400)
    daily_budget_usd: float | None = Field(default=None, ge=0, le=10000)
    monthly_budget_usd: float | None = Field(default=None, ge=0, le=100000)


class EstimateRequest(BaseModel):
    prompt: str = ""
    models: list[str]
    max_tokens: int = Field(default=4096, ge=16, le=8192)
    synthesize: bool = True
    judge_model: str | None = None


class SuggestPanelRequest(BaseModel):
    budget_usd: float = Field(gt=0, le=1000)
    max_tokens: int = Field(default=2048, ge=16, le=8192)
    synthesize: bool = False
    quality_floor: int | None = Field(default=None, ge=0, le=100)