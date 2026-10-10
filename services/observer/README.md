# Pretrained security observer

The authenticated Python service runs a pinned prompt-injection classifier. APX calls it through a bounded server adapter and seals its advisory evidence into support-plan receipts. It has no tool credentials, approval capability, or permission-changing output.

## Local Windows setup

Use Python 3.12 and the project's Node runtime. From the project root:

```powershell
python -m venv services/observer/.venv
services/observer/.venv/Scripts/python.exe -m pip install -r services/observer/requirements-torch.txt
services/observer/.venv/Scripts/python.exe -m pip install -r services/observer/requirements-dev.txt
npm run observer:dev
```

The helper generates a random service credential in ignored `.env.observer.local` and configures ignored `.dev.vars`, preserving other entries. It downloads the public PIGuard checkpoint on first start, caches it inside `.models`, and starts one warm process on `127.0.0.1:8091`. Neither credentials nor weights belong in Git. Windows uses the directory's existing access controls; POSIX writes request mode `0600`.

In a second terminal, initialize the local database if needed and start the app:

```powershell
npm run db:local:init
npm run dev
```

Open `http://localhost:5173/observer`. The four bottom-dock panels provide scanning, actual results and JSON export, connection setup, and experimental methodology. Support plans also carry an observation of customer context and proposed replies. Restart the app after changing service configuration. On Linux/macOS use `.venv/bin/python` for installation; the Node helper selects the platform's executable automatically.

## Models and precision

Only three immutable revisions are accepted by both service and application:

| Key | Model | Revision | Access |
| --- | --- | --- | --- |
| `piguard` | `leolee99/PIGuard` | `dd78b24e330193a22d2293ac66922dd4f982f563` | Public, model card lists MIT |
| `prompt-guard-22m` | `meta-llama/Llama-Prompt-Guard-2-22M` | `11614a155199674a0a95e6602d6ab0417b790ed0` | Gated, Llama license |
| `prompt-guard-86m` | `meta-llama/Llama-Prompt-Guard-2-86M` | `a8ded8e697ce7c355e395a0df51f94adb4a2fd27` | Gated, Llama license |

For Meta models, accept the terms yourself on Hugging Face and configure a read-only `HF_TOKEN` in the inference process environment. Do not send the token in chat or a browser form. Set `OBSERVER_MODEL_KEY` before `npm run observer:dev`; one process loads one model. The page lists unloaded models as unavailable. Meta inference requires access and separate verification; public-model results cannot establish Meta performance.

The local helper defaults to CPU, two threads and `bfloat16` to reduce memory pressure. Set `OBSERVER_PRECISION=float32` for a separate precision comparison. Every result records precision, device, revision, threshold, token coverage and request latency. CUDA requires an appropriate PyTorch installation and separate testing; the supplied CPU installation does not claim GPU acceleration.

PIGuard's small custom first-token classifier head is reproduced in local audited code; `trust_remote_code` remains false. Its original F32 safetensors checksum is verified before a bounded-memory loader converts tensors. Loading rejects missing tensors, extra tensors, wrong shapes and unexpected checkpoint data. On Windows this avoids a checkpoint-sized copy-on-write allocation during startup. No pickle checkpoint is accepted.

## Boundaries and failure behavior

- Service access requires a bearer secret; the app endpoints also enforce owner authentication and same-origin mutation checks.
- Accept at most eight texts, 6,000 characters each and 12,000 total, within a 64 KiB JSON body. Unknown fields and arbitrary model IDs are rejected.
- Use 512-token windows including special tokens, 64-token overlap and at most 32 segments. Incomplete coverage returns `unknown`, even if all scanned segments look benign.
- A single inference slot refuses concurrent work instead of building an unbounded queue. The adapter has a bounded deadline, response size, strict evidence validation and no redirects.
- Recognizable credentials and email addresses are redacted by the app adapter. Unknown confidential formats may remain, so configure an inference destination appropriate for your data.
- Model scores are experimental, uncalibrated signals. A benign result cannot authorize an action. Missing, timed-out or malformed observations record unknown/unavailable evidence while existing policy and mandatory approval rules continue unchanged.
- Evidence omits the submitted prose. Support plans retain their existing separately redacted context. Service errors use fixed messages and access logging is disabled.

## Reproducible checks

With the app and observer running:

```powershell
npm run check:observer
npm run evaluate:observer
```

The first checks real pretrained inference, HTTP validation and support/external-proposal approval boundaries, then rejects only its own staged test plans. It also calls the helper's authenticated loopback service directly to verify overlapping windows, records its actual time, and checks that the app returns unknown if its shorter deadline expires. It executes no refund or reply action. The second scans 12 authored development examples sequentially and writes actual model metadata, misses, false alarms and app round-trip measurements to `output/observer-evaluation.json`. These fixtures are not a held-out benchmark. Threshold tuning on these examples would not justify production accuracy or reduced human-review claims.

The tested CPU/bfloat16 configuration took approximately 25 seconds for a 540-token, two-window input. The helper configures the app's maximum 15-second observer deadline, so that input correctly becomes unavailable/unknown in the app. Short-input p50/p95 measurements cannot be extrapolated to long tickets. An observer timeout also does not interrupt the service's already running CPU operation; further observations may briefly receive a busy response. A faster measured model/host is needed before relying on this for interactive long-input screening.

Service tests run from this directory:

```powershell
.venv/Scripts/python.exe -m pytest -q
```

They verify coverage, budget exhaustion, invalid scores, concurrency, authentication, strict input and checkpoint integrity without downloading model weights. Use the HTTP checks to verify actual pretrained inference. General app checks remain `npm run typecheck`, `npm test` and `npm run build`. On a memory-constrained machine, stop the observer while building and use sequential Node tests.

## Deployment

Weights run in a separate inference host, not the Cloudflare Worker. Configure app-server `OBSERVER_URL` (HTTPS), `OBSERVER_TOKEN`, `OBSERVER_MODEL` and optional `OBSERVER_TIMEOUT_MS` (500–15,000 ms). Leave `OBSERVER_ALLOW_LOCAL` unset in hosting; its only purpose is explicit loopback HTTP development. A deployed Worker cannot reach your laptop's localhost service.

The included Dockerfile is a deployment starting point, not a tested hosted deployment. It binds port 8091 inside the container and requires a TLS ingress, injected service secret, persistent model cache, sufficient memory and a suitable private network configuration. Keep a single worker per loaded model; add capacity deliberately after measuring queue refusal, latency and memory. Do not expose unauthenticated inference. Hosting cost and infrastructure selection require the owner's budget before provisioning.

The initial release stays in shadow mode. Reduced operator effort requires a separately designed, evaluated autonomous scope; this service does not supply human approval or automatically dispatch allowed plans.
