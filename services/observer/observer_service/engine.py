"""Bounded token coverage and classification; no execution or approval capability."""

import math
import threading
import time
from dataclasses import dataclass
from typing import Callable, Protocol, Sequence

from .registry import MAX_SEGMENTS, OVERLAP_TOKENS, THRESHOLD, WINDOW_TOKENS, ModelSpec


class Tokenizer(Protocol):
    def encode(self, text: str, *, add_special_tokens: bool) -> list[int]: ...
    def num_special_tokens_to_add(self, pair: bool = False) -> int: ...


@dataclass(frozen=True)
class Segment:
    text_id: str
    start: int
    end: int
    ids: tuple[int, ...]


class ObserverBusy(Exception):
    pass


class ModelMismatch(Exception):
    pass


class ObserverEngine:
    def __init__(
        self,
        spec: ModelSpec,
        tokenizer: Tokenizer,
        scorer: Callable[[Sequence[tuple[int, ...]]], Sequence[float]],
        device: str = "cpu",
        precision: str = "float32",
    ):
        self.spec = spec
        self.tokenizer = tokenizer
        self.scorer = scorer
        self.device = device
        self.precision = precision
        self._slot = threading.BoundedSemaphore(1)
        self.content_window = WINDOW_TOKENS - tokenizer.num_special_tokens_to_add(pair=False)
        if not OVERLAP_TOKENS < self.content_window <= WINDOW_TOKENS:
            raise ValueError("The tokenizer has an unsupported special-token count.")

    @property
    def identity(self):
        return {"key": self.spec.key, "id": self.spec.id, "revision": self.spec.revision, "device": self.device, "precision": self.precision}

    def observe(self, texts, model_key=None):
        if model_key is not None and model_key != self.spec.key:
            raise ModelMismatch()
        if not self._slot.acquire(blocking=False):
            raise ObserverBusy()
        started = time.perf_counter()
        try:
            segments, total_tokens, complete = self._segments(texts)
            scores = list(self.scorer([segment.ids for segment in segments])) if segments else []
            if len(scores) != len(segments) or any(not math.isfinite(score) or not 0 <= score <= 1 for score in scores):
                raise RuntimeError("The model returned invalid scores.")
            maximum = max(scores) if scores else None
            verdict = "unknown" if not complete or maximum is None else "suspicious" if maximum >= THRESHOLD else "benign"
            reason = (
                "The segment budget was exhausted; unscanned text remains."
                if not complete else
                "No content tokens were available for classification."
                if maximum is None else
                "At least one segment reached the experimental suspicious threshold."
                if verdict == "suspicious" else
                "All scanned segments were below the experimental threshold; this does not grant authority."
            )
            return {
                "schemaVersion": 1,
                "mode": "shadow",
                "status": "observed",
                "verdict": verdict,
                "model": self.identity,
                "threshold": THRESHOLD,
                "maxScore": maximum,
                "segments": [
                    {
                        "textId": segment.text_id,
                        "startToken": segment.start,
                        "endToken": segment.end,
                        "score": score,
                        "label": "suspicious" if score >= THRESHOLD else "benign",
                    }
                    for segment, score in zip(segments, scores, strict=True)
                ],
                "coverage": {
                    "complete": complete,
                    "windowTokens": WINDOW_TOKENS,
                    "overlapTokens": OVERLAP_TOKENS,
                    "totalTokens": total_tokens,
                    "segments": len(segments),
                },
                "latencyMs": round((time.perf_counter() - started) * 1000, 3),
                "reason": reason,
            }
        finally:
            self._slot.release()

    def _segments(self, texts):
        segments = []
        complete = True
        total_tokens = 0
        for item in texts:
            token_ids = self.tokenizer.encode(item.text, add_special_tokens=False)
            total_tokens += len(token_ids)
            start = 0
            while start < len(token_ids):
                if len(segments) >= MAX_SEGMENTS:
                    complete = False
                    break
                end = min(start + self.content_window, len(token_ids))
                segments.append(Segment(item.id, start, end, tuple(token_ids[start:end])))
                if end == len(token_ids):
                    break
                start = end - OVERLAP_TOKENS
        return segments, total_tokens, complete
