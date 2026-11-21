from pydantic import BaseModel, Field


class CompareRequest(BaseModel):
    prompt: str
    models: list[str]
    max_tokens: int = Field(default=2048, ge=16, le=2048)
    synthesize: bool = True


class PreferenceRequest(BaseModel):
    model: str
    reason: str = ""


class SettingsUpdate(BaseModel):
    latency_slo_s: float | None = Field(default=None, gt=0, le=120)
    quality_threshold: int | None = Field(default=None, ge=0, le=100)
    adaptive_escalation: bool | None = None
    max_tokens: int | None = Field(default=None, ge=16, le=2048)
    synthesize: bool | None = None
    judge_model: str | None = None