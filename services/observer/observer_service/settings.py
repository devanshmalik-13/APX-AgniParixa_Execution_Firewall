import os
from dataclasses import dataclass

from .registry import MODELS


@dataclass(frozen=True)
class Settings:
    token: str
    model_key: str = "piguard"
    device: str = "cpu"
    cpu_threads: int = 2
    precision: str = "float32"

    def __post_init__(self):
        if len(self.token) < 32 or len(self.token) > 512 or any(c.isspace() for c in self.token):
            raise ValueError("OBSERVER_SERVICE_TOKEN must be a random token of 32–512 non-space characters.")
        if self.model_key not in MODELS:
            raise ValueError("OBSERVER_MODEL_KEY must be an allowlisted model key.")
        if self.device not in {"cpu", "cuda"}:
            raise ValueError("OBSERVER_DEVICE must be cpu or cuda.")
        if not 1 <= self.cpu_threads <= 8:
            raise ValueError("OBSERVER_CPU_THREADS must be between 1 and 8.")
        if self.precision not in {"float32", "bfloat16"}:
            raise ValueError("OBSERVER_PRECISION must be float32 or bfloat16.")

    @classmethod
    def from_environment(cls):
        return cls(
            token=os.environ.get("OBSERVER_SERVICE_TOKEN", ""),
            model_key=os.environ.get("OBSERVER_MODEL_KEY", "piguard"),
            device=os.environ.get("OBSERVER_DEVICE", "cpu"),
            cpu_threads=int(os.environ.get("OBSERVER_CPU_THREADS", "2")),
            precision=os.environ.get("OBSERVER_PRECISION", "float32"),
        )
