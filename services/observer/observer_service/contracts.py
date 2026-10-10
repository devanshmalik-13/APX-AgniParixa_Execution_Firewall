from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ModelKey = Literal["prompt-guard-22m", "prompt-guard-86m", "piguard"]


class ObserverText(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    source: Literal["customer_context", "proposed_reply"]
    text: str = Field(min_length=1, max_length=6000)


class ObserveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    modelKey: ModelKey | None = None
    texts: list[ObserverText] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def bounded_texts(self):
        if len({item.id for item in self.texts}) != len(self.texts):
            raise ValueError("Text IDs must be unique.")
        if sum(len(item.text) for item in self.texts) > 12000:
            raise ValueError("The total character limit is 12000.")
        for item in self.texts:
            try:
                item.text.encode("utf-8")
            except UnicodeEncodeError:
                raise ValueError("Text must contain valid Unicode.") from None
        return self


class ModelIdentity(BaseModel):
    key: ModelKey
    id: str
    revision: str = Field(pattern=r"^[0-9a-f]{40}$")
    device: Literal["cpu", "cuda"]
    precision: Literal["float32", "bfloat16"]


class HealthResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    status: Literal["ready"] = "ready"
    model: ModelIdentity
    windowTokens: Literal[512] = 512
    overlapTokens: Literal[64] = 64
    threshold: float = Field(ge=0, le=1)


class SegmentResult(BaseModel):
    textId: str
    startToken: int = Field(ge=0)
    endToken: int = Field(gt=0)
    score: float = Field(ge=0, le=1, allow_inf_nan=False)
    label: Literal["benign", "suspicious"]


class Coverage(BaseModel):
    complete: bool
    windowTokens: Literal[512] = 512
    overlapTokens: Literal[64] = 64
    totalTokens: int = Field(ge=0)
    segments: int = Field(ge=0, le=32)


class ObservationResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    mode: Literal["shadow"] = "shadow"
    status: Literal["observed"] = "observed"
    verdict: Literal["benign", "suspicious", "unknown"]
    model: ModelIdentity
    threshold: float = Field(ge=0, le=1)
    maxScore: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    segments: list[SegmentResult] = Field(max_length=32)
    coverage: Coverage
    latencyMs: float = Field(ge=0, allow_inf_nan=False)
    reason: str
