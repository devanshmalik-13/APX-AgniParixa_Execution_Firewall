from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSpec:
    key: str
    id: str
    revision: str
    gated: bool
    license: str


# Explicit immutable revisions, verified against the publishers on 2026-10-10.
# Request data must never become an arbitrary model ID, revision, or Python import.
MODELS = {
    "prompt-guard-22m": ModelSpec(
        "prompt-guard-22m",
        "meta-llama/Llama-Prompt-Guard-2-22M",
        "11614a155199674a0a95e6602d6ab0417b790ed0",
        True,
        "llama4",
    ),
    "prompt-guard-86m": ModelSpec(
        "prompt-guard-86m",
        "meta-llama/Llama-Prompt-Guard-2-86M",
        "a8ded8e697ce7c355e395a0df51f94adb4a2fd27",
        True,
        "llama4",
    ),
    "piguard": ModelSpec(
        "piguard",
        "leolee99/PIGuard",
        "dd78b24e330193a22d2293ac66922dd4f982f563",
        False,
        "mit",
    ),
}

WINDOW_TOKENS = 512
OVERLAP_TOKENS = 64
MAX_SEGMENTS = 32
THRESHOLD = 0.9
