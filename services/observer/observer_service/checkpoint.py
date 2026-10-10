"""Bounded-memory loading of the pinned PIGuard F32 safetensor checkpoint.

Windows can reserve a checkpoint-sized copy-on-write mapping even with lazy
loading. This reader verifies the published immutable file checksum, validates
its tensor header, and converts bounded chunks into the requested precision.
It accepts no pickle or executable model code.
"""

import hashlib
import json
import math
import struct
from pathlib import Path


PIGUARD_SHA256 = "f90b9806de93b6286cda517300d4b55e5ce2e5ccbf8339dc59be21ca0dd9a25e"


def checkpoint_header(path, expected_sha256):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for part in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(part)
    if digest.hexdigest() != expected_sha256:
        raise RuntimeError("The pinned checkpoint checksum did not match.")
    with path.open("rb") as handle:
        prefix = handle.read(8)
        if len(prefix) != 8:
            raise RuntimeError("The checkpoint header is incomplete.")
        header_size = struct.unpack("<Q", prefix)[0]
        if not 2 <= header_size <= 1024 * 1024:
            raise RuntimeError("The checkpoint header size is unsupported.")
        header = json.loads(handle.read(header_size))
    tensors = {name: item for name, item in header.items() if name != "__metadata__"}
    data_start = 8 + header_size
    intervals = []
    for name, item in tensors.items():
        if not isinstance(name, str) or not isinstance(item, dict) or set(item) != {"dtype", "shape", "data_offsets"}:
            raise RuntimeError("Unsupported checkpoint tensor header.")
        shape, offsets = item["shape"], item["data_offsets"]
        if item["dtype"] != "F32" or not isinstance(shape, list) or any(type(n) is not int or n < 0 for n in shape):
            raise RuntimeError("Unsupported checkpoint tensor dtype or shape.")
        if not isinstance(offsets, list) or len(offsets) != 2 or any(type(n) is not int or n < 0 for n in offsets):
            raise RuntimeError("Invalid checkpoint offsets.")
        start, end = offsets
        if end - start != math.prod(shape) * 4 or data_start + end > path.stat().st_size:
            raise RuntimeError("Checkpoint tensor size did not match its shape.")
        intervals.append((start, end))
    previous = 0
    for start, end in sorted(intervals):
        if start != previous:
            raise RuntimeError("Checkpoint tensors overlap or contain gaps.")
        previous = end
    if data_start + previous != path.stat().st_size:
        raise RuntimeError("Unexpected trailing checkpoint data.")
    return tensors, data_start


def load_piguard_checkpoint(model, path, dtype, expected_sha256=PIGUARD_SHA256):
    import torch

    tensors, data_start = checkpoint_header(path, expected_sha256)
    expected = model.state_dict()
    if set(tensors) != set(expected):
        raise RuntimeError("Checkpoint tensor names did not match the audited architecture.")
    loaded = {}
    with open(path, "rb") as handle:
        for name, item in tensors.items():
            if tuple(item["shape"]) != tuple(expected[name].shape):
                raise RuntimeError("Checkpoint tensor shape did not match the audited architecture.")
            tensor = torch.empty(item["shape"], dtype=dtype, device="cpu")
            flattened = tensor.reshape(-1)
            start, end = item["data_offsets"]
            handle.seek(data_start + start)
            cursor = 0
            remaining = end - start
            while remaining:
                count = min(remaining, 4 * 1024 * 1024)
                part = bytearray(handle.read(count))
                if len(part) != count:
                    raise RuntimeError("Checkpoint tensor data was truncated.")
                source = torch.frombuffer(part, dtype=torch.float32)
                flattened[cursor:cursor + source.numel()].copy_(source)
                cursor += source.numel()
                remaining -= count
            loaded[name] = tensor
    model.load_state_dict(loaded, strict=True, assign=True)
    # The native DeBERTa embeddings keep positional IDs as a nonpersistent
    # buffer, so they are intentionally absent from the checkpoint state dict.
    for name, buffer in list(model.named_buffers()):
        if buffer.is_meta:
            if not name.endswith("position_ids") or buffer.dtype != torch.long:
                raise RuntimeError("An unsupported nonpersistent model buffer was not initialized.")
            module_name, attribute = name.rsplit(".", 1)
            setattr(model.get_submodule(module_name), attribute, torch.arange(buffer.shape[-1], dtype=torch.long).expand(buffer.shape))
    return model
