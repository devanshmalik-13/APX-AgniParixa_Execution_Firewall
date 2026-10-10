"""Pinned safetensor checkpoints, built-in tokenizers, and locally audited model code."""

import json
import os

from .engine import ObserverEngine
from .registry import MODELS


def load_engine(settings):
    # Deferred imports let segmentation tests run without downloading an ML runtime.
    import torch
    from huggingface_hub import hf_hub_download
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, DebertaV2Config, DebertaV2ForSequenceClassification
    from transformers.modeling_outputs import SequenceClassifierOutput

    spec = MODELS[settings.model_key]
    dtype = torch.bfloat16 if settings.precision == "bfloat16" else torch.float32
    torch.set_num_threads(settings.cpu_threads)
    if settings.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was selected, but a usable CUDA runtime is unavailable.")

    common = {"revision": spec.revision, "token": os.environ.get("HF_TOKEN") or None}
    tokenizer = AutoTokenizer.from_pretrained(spec.id, trust_remote_code=False, **common)
    if spec.key == "piguard":
        # The publisher's pinned custom class differs from the standard pooled head.
        # Reproduce only its inspected first-token classification head locally. Never
        # download/import remote Python or call trust_remote_code=True.
        class AuditedPIGuard(DebertaV2ForSequenceClassification):
            def __init__(self, config):
                super().__init__(config)
                self.classifier = torch.nn.Linear(config.hidden_size, config.num_labels)

            def forward(self, input_ids=None, attention_mask=None, **kwargs):
                output = self.deberta(input_ids=input_ids, attention_mask=attention_mask, output_hidden_states=False)
                return SequenceClassifierOutput(logits=self.classifier(output.last_hidden_state[:, 0, :]))

        config_path = hf_hub_download(spec.id, "config.json", **common)
        with open(config_path, encoding="utf-8") as handle:
            raw_config = json.load(handle)
        # Ignore publisher AutoConfig mappings by selecting the audited native class.
        raw_config.pop("auto_map", None)
        raw_config["model_type"] = "deberta-v2"
        config = DebertaV2Config.from_dict(raw_config)
        from .checkpoint import load_piguard_checkpoint
        checkpoint_path = hf_hub_download(spec.id, "model.safetensors", **common)
        # Allocate only metadata before loading each verified tensor in small chunks.
        with torch.device("meta"):
            model = AuditedPIGuard(config)
        model = load_piguard_checkpoint(model, checkpoint_path, dtype)
        loading = {}
    else:
        model, loading = AutoModelForSequenceClassification.from_pretrained(
            spec.id, use_safetensors=True, trust_remote_code=False,
            output_loading_info=True, dtype=dtype, **common,
        )
    if loading.get("missing_keys") or loading.get("unexpected_keys") or loading.get("mismatched_keys"):
        raise RuntimeError("Checkpoint tensors did not match the audited model architecture.")
    labels = {int(index): str(label).lower() for index, label in model.config.id2label.items()}
    suspicious = [index for index, label in labels.items() if label in {"injection", "malicious"}]
    benign = [index for index, label in labels.items() if label == "benign"]
    if len(labels) != 2 or len(suspicious) != 1 or len(benign) != 1:
        raise RuntimeError("Checkpoint labels did not match the supported binary classifier contract.")
    model.to(settings.device)
    model.eval()

    # These pinned DeBERTa tokenizers use a single CLS/content/SEP sequence.
    # Transformers 5 removed the legacy build_inputs_with_special_tokens API.
    probe = "Observer tokenizer compatibility check."
    if any(value is None for value in (tokenizer.cls_token_id, tokenizer.sep_token_id, tokenizer.pad_token_id)):
        raise RuntimeError("The checkpoint tokenizer is missing required special tokens.")
    if tokenizer.encode(probe, add_special_tokens=True) != [
        tokenizer.cls_token_id, *tokenizer.encode(probe, add_special_tokens=False), tokenizer.sep_token_id,
    ]:
        raise RuntimeError("The checkpoint tokenizer uses an unsupported sequence format.")

    def score_segments(segments):
        scores = []
        # Bound activation memory as well as checkpoint memory on local CPUs.
        for offset in range(0, len(segments)):
            sequences = [[tokenizer.cls_token_id, *segments[offset], tokenizer.sep_token_id]]
            if any(len(sequence) > 512 for sequence in sequences):
                raise RuntimeError("An input exceeded the model token window.")
            length = max(map(len, sequences))
            input_ids = torch.tensor(
                [sequence + [tokenizer.pad_token_id] * (length - len(sequence)) for sequence in sequences],
                dtype=torch.long, device=settings.device,
            )
            attention_mask = torch.tensor(
                [[1] * len(sequence) + [0] * (length - len(sequence)) for sequence in sequences],
                dtype=torch.long, device=settings.device,
            )
            with torch.inference_mode():
                logits = model(input_ids=input_ids, attention_mask=attention_mask).logits
                probabilities = torch.softmax(logits.float(), dim=-1)[:, suspicious[0]]
            scores.extend(probabilities.detach().cpu().tolist())
        return scores

    engine = ObserverEngine(spec, tokenizer, score_segments, settings.device, settings.precision)
    # Do not advertise readiness until loading and one real inference succeed.
    engine.observe([type("WarmupText", (), {"id": "warmup", "text": "Please explain this invoice."})()])
    return engine
