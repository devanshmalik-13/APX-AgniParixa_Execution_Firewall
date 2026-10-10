import hashlib
import json
import struct
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from observer_service.app import create_app
from observer_service.checkpoint import checkpoint_header, load_piguard_checkpoint
from observer_service.engine import ObserverBusy, ObserverEngine
from observer_service.registry import MODELS
from observer_service.settings import Settings


class Tokenizer:
    def encode(self, text, *, add_special_tokens):
        return [ord(char) for char in text]

    def num_special_tokens_to_add(self, pair=False):
        return 2


def engine(scorer=None):
    return ObserverEngine(MODELS["piguard"], Tokenizer(), scorer or (lambda items: [0.1 for _ in items]))


def text(value, identifier="customer"):
    return SimpleNamespace(id=identifier, text=value)


def test_long_inputs_have_overlap_and_complete_boundary_coverage():
    result = engine().observe([text("a" * 1200)])
    assert [(s["startToken"], s["endToken"]) for s in result["segments"]] == [(0, 510), (446, 956), (892, 1200)]
    assert result["coverage"]["totalTokens"] == 1200
    assert result["coverage"]["complete"]
    assert result["verdict"] == "benign"


def test_budget_exhaustion_is_unknown_even_with_benign_partial_results():
    result = engine().observe([text("a" * 6000, str(i)) for i in range(3)])
    assert len(result["segments"]) == 32
    assert result["coverage"]["totalTokens"] == 18000
    assert not result["coverage"]["complete"]
    assert result["verdict"] == "unknown"


def test_any_flagged_segment_marks_complete_input_suspicious_without_permissions():
    result = engine(lambda items: [0.95 if ord("!") in item else 0.1 for item in items]).observe([text("a" * 900 + "!")])
    assert result["verdict"] == "suspicious"
    assert result["maxScore"] == 0.95
    assert "approve" not in result and "actions" not in result
    assert "a" * 900 not in json.dumps(result)


def test_concurrent_inference_refuses_unbounded_queue_and_releases_slot():
    entered, release = threading.Event(), threading.Event()

    def blocking(items):
        entered.set()
        assert release.wait(5)
        return [0.1 for _ in items]

    instance = engine(blocking)
    worker = threading.Thread(target=lambda: instance.observe([text("hello")]))
    worker.start()
    assert entered.wait(5)
    with pytest.raises(ObserverBusy):
        instance.observe([text("second")])
    release.set()
    worker.join(5)
    assert instance.observe([text("third")])["status"] == "observed"


@pytest.mark.parametrize("score", [float("nan"), float("inf"), -0.1, 1.1])
def test_invalid_scores_never_become_benign(score):
    with pytest.raises(RuntimeError):
        engine(lambda items: [score for _ in items]).observe([text("hello")])


def test_authentication_validation_and_model_selection_do_not_leak_text():
    token = "t" * 64
    with TestClient(create_app(Settings(token), lambda _: engine())) as client:
        assert client.get("/health").status_code == 401
        headers = {"Authorization": "Bearer " + token}
        health = client.get("/health", headers=headers)
        assert health.status_code == 200
        assert health.json()["model"]["revision"] == MODELS["piguard"].revision
        body = {"texts": [{"id": "customer", "source": "customer_context", "text": "private customer text"}]}
        assert client.post("/v1/observe", json=body).status_code == 401
        observed = client.post("/v1/observe", json=body, headers=headers)
        assert observed.status_code == 200
        assert "private customer text" not in observed.text
        assert client.post("/v1/observe", json={**body, "approve": True}, headers=headers).status_code == 422
        assert client.post("/v1/observe", json={**body, "modelKey": "prompt-guard-86m"}, headers=headers).status_code == 409
        bad = client.post("/v1/observe", json={"texts": [{**body["texts"][0], "text": "private customer text" * 600}]}, headers=headers)
        assert bad.status_code == 422
        assert "private customer text" not in bad.text
        assert client.post("/v1/observe", content=b"x" * 65537, headers={**headers, "Content-Type": "application/json"}).status_code == 413


def test_model_errors_are_fixed_responses_and_do_not_disclose_customer_or_token():
    with TestClient(create_app(Settings("t" * 64), lambda _: engine(lambda _: (_ for _ in ()).throw(RuntimeError("private model diagnostic"))))) as client:
        result = client.post("/v1/observe", json={"texts": [{"id": "a", "source": "customer_context", "text": "private customer text"}]}, headers={"Authorization": "Bearer " + "t" * 64})
        assert result.status_code == 503
        assert "private" not in result.text


def test_checkpoint_integrity_and_offset_validation(tmp_path):
    path = tmp_path / "model.safetensors"
    header = json.dumps({"weight": {"dtype": "F32", "shape": [2], "data_offsets": [0, 8]}}).encode()
    raw = struct.pack("<Q", len(header)) + header + struct.pack("<ff", 1, 2)
    path.write_bytes(raw)
    checksum = hashlib.sha256(raw).hexdigest()
    tensors, start = checkpoint_header(path, checksum)
    assert tensors["weight"]["shape"] == [2]
    assert start == 8 + len(header)
    with pytest.raises(RuntimeError, match="checksum"):
        checkpoint_header(path, "0" * 64)
    path.write_bytes(raw + b"extra")
    with pytest.raises(RuntimeError, match="trailing"):
        checkpoint_header(path, hashlib.sha256(path.read_bytes()).hexdigest())


@pytest.mark.parametrize("precision", ["float32", "bfloat16"])
def test_bounded_checkpoint_loader_assigns_verified_tensors_with_requested_precision(tmp_path, precision):
    import torch

    values = {"weight": ([2, 2], [1.125, -2.25, 3.5, 4]), "bias": ([2], [0.5, -0.75])}
    header, chunks, cursor = {}, [], 0
    for name, (shape, data) in values.items():
        chunk = struct.pack("<" + "f" * len(data), *data)
        header[name] = {"dtype": "F32", "shape": shape, "data_offsets": [cursor, cursor + len(chunk)]}
        chunks.append(chunk)
        cursor += len(chunk)
    encoded = json.dumps(header).encode()
    raw = struct.pack("<Q", len(encoded)) + encoded + b"".join(chunks)
    path = tmp_path / "fixture.safetensors"
    path.write_bytes(raw)
    with torch.device("meta"):
        model = torch.nn.Linear(2, 2)
    dtype = getattr(torch, precision)
    loaded = load_piguard_checkpoint(model, path, dtype, hashlib.sha256(raw).hexdigest())
    for name, (shape, data) in values.items():
        tensor = loaded.state_dict()[name]
        assert tensor.device.type == "cpu" and tensor.dtype == dtype
        assert torch.equal(tensor, torch.tensor(data, dtype=dtype).reshape(shape))
