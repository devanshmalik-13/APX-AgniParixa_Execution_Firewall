# Small observer models for APX

Research date: 10 October 2026. The implementation now includes authenticated shadow inference, validated segment evidence, support-plan receipt integration and a four-panel observer workspace. Public PIGuard has been installed and tested locally; no model has execution or approval authority. The Meta variants remain pending gated access and actual inference verification. Reproduction steps are in [services/observer/README.md](./services/observer/README.md).

The latest sequential CPU/bfloat16 run on 12 authored development examples produced one missed mixed-language injection and one false alarm on a harmless quoted attack, with no unknown results. App round-trip p50 was 2,321 ms and p95 was 2,951 ms. These are local development measurements, not held-out accuracy or model-only latency. The result supports retaining shadow mode; it establishes no reduction in review effort. The reproducible runner writes the current measured evidence to `output/observer-evaluation.json`.

A separate 540-token input produced two complete overlapping windows in 24,970 ms at the inference service. The app correctly expired its 15-second deadline and returned unavailable/unknown evidence, rather than calling incomplete work benign. Longer inputs on this CPU are a practical latency limitation. The HTTP report records the actual complete-service and deadline-limited application measurements in `output/observer-http-check.json`.

Implementation verification: 217 application tests and 13 Python tests passed, together with six real-service HTTP check groups, TypeScript checking and a production build. Browser checks covered all four observer panels at 1366×768, 390×844, 320×568 and 844×390, with no outer-page or panel horizontal overflow. Evidence download, sample/source/model controls, dock pinning and keyboard panel navigation were exercised. This validates the implemented workflow; it does not establish production detection accuracy or reduced human workload. Publication remains pending restoration of Sites access to the existing project and configuration of a hosted inference service.

## Decision

Test a specialized prompt-injection classifier as supplementary evidence. Start with Meta Prompt Guard 2 86M and compare the 22M variant as a speed control. Include PIGuard as an alternative focused on false alarms. Add a contextual reviewer only if task-level experiments show a gap that a text classifier cannot address.

This can improve detection and triage. It does not automatically reduce mandatory approvals, and adding another inference step does not automatically improve machine latency. Human waiting time, inference time, and total completion time must be measured separately.

## What the existing application already does

`lib/support/policy.ts` derives authority from trusted ticket and invoice records. It denies malformed arguments, cross-customer invoice access, bulk exports, incorrect reply recipients, recognizable secrets, repeated refunds, and refunds above the trusted entitlement. Approval cannot authorize a denied action. Standard policy marks permitted lower-risk actions as `allow`; strict policy and refunds above the automatic threshold require approval.

`components/support-workspace.tsx` still stages plans and requires an operator to trigger execution, including plans whose actions are all `allow`. The policy's allowance is not an existing automatic dispatch feature. `lib/support/store.ts` revalidates authority and immutable receipts before committing. External proposals always use strict review.

Consequently, fewer clicks would require an explicit automatic execution workflow for an owner-configured, limited scope. A detector must not silently change strict external proposals into standard proposals or supply operator approval.

## Model shortlist

### Meta Llama Prompt Guard 2 86M: first security experiment

This is a binary text classifier for explicit attempts to override instructions, rather than a general chat model. Its multilingual base and evaluations that include Hindi make it a stronger initial candidate for mixed-language support input. It has a 512-token window, so long tickets and tool outputs need bounded, overlapping segments and explicit coverage reporting. It cannot determine whether a refund is actually entitled or whether a plausible reply is grounded in invoice data.

Meta reports 97.5% English recall at a 1% false-positive rate and 92.4 ms per 512-token classification on an A100. These are vendor benchmark results, not APX measurements or CPU estimates. Adaptive attacks and application-specific inputs remain limitations. Access is gated under the Llama 4 Community License. The name denotes the backbone size; it is not the full checkpoint parameter count or memory requirement. [Official model card](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M).

### Meta Llama Prompt Guard 2 22M: speed comparison

The smaller variant performs the same classification task and uses the same 512-token window. Meta reports 19.3 ms on an A100 and 88.7% English recall at a 1% false-positive rate. Its base lacks multilingual pretraining, and its multilingual performance falls further behind the 86M variant. It is worth testing for mostly English traffic under tight latency constraints, rather than choosing it solely because its advertised size is smaller. It also has gated access and the Llama 4 Community License. [Official model card](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-22M).

### PIGuard: false-alarm comparison

`leolee99/PIGuard`, formerly InjecGuard, is a DeBERTa-based injection classifier; Hugging Face lists approximately 0.2B total parameters and an MIT license. Its research specifically studies benign text being flagged because it contains attack-like trigger words, using the NotInject dataset. That matches a relevant APX problem: a customer quoting an injection example or discussing a security issue should not automatically lose legitimate support service.

It is a useful experimental comparator, not a demonstrated winner for our tickets. The card tags English and loading uses custom model code; inspect and pin that code and the weights before running them. [Author model card](https://huggingface.co/leolee99/PIGuard), [ACL paper](https://aclanthology.org/2025.acl-long.1468/).

### Sentinel v2: longer-input comparison

`rogue-security/prompt-injection-jailbreak-sentinel-v2` uses Qwen3-0.6B with a classification head for injection and jailbreak detection. Its card lists 596M parameters, 32K context, English evaluation, gated access, and an Elastic license. Longer context makes it a candidate when segmentation loses relationships across a document; it does not establish resilience to long or distributed attacks. Compare it only if that issue occurs in our application, because it adds serving and licensing considerations beyond the smaller first-stage classifiers. Do not compare its published latency or F1 directly with Meta's different benchmark conditions. [Official model card](https://huggingface.co/rogue-security/prompt-injection-jailbreak-sentinel-v2).

### IBM Granite Guardian 3.2 3B-A800M: contextual observer experiment

This older, smaller Guardian supports groundedness and function-calling hallucination checks, including semantic errors relative to a user query and available tools. It is a better task-level experiment than asking an input-only detector whether a proposed plan satisfies the customer's request. Use trusted task facts and tool definitions plus clearly separated untrusted evidence; retain the prescribed scoring template.

It has roughly 3B total parameters with about 800M active parameters: active compute is not total memory. Its card states Apache 2.0 licensing and English-only training/testing. Custom risk definitions require application testing. IBM's newer Guardian 4.1 is an 8B model, so it is not the first choice for this small-model latency experiment. Neither model's approval-like output grants authority. [3.2 model card](https://huggingface.co/ibm-granite/granite-guardian-3.2-3b-a800m), [4.1 model card](https://huggingface.co/ibm-granite/granite-guardian-4.1-8b).

## Other models considered

- Qwen3Guard-Gen-0.6B is a multilingual content moderation model with three severity labels and stated support for 119 languages/dialects. It is useful if harmful replies are part of the product's threat model. A harmless-looking customer export or incorrect refund is still an authorization violation, which this moderation label does not resolve. Its Apache 2.0 license is attractive, but content moderation should be evaluated separately from injection detection. [Official model card](https://huggingface.co/Qwen/Qwen3Guard-Gen-0.6B).
- ProtectAI's DeBERTa prompt-injection v2 card now says the project is archived and no longer maintained. It documents English-only injection detection, no jailbreak detection, and false positives when scanning system prompts. Keep it as a historical baseline rather than a preferred new primary deployment. [Official model card](https://huggingface.co/protectai/deberta-v3-base-prompt-injection-v2).
- NVIDIA Nemotron Content Safety Reasoning 4B offers custom content policies and reasoning/non-reasoning modes. It is a possible later custom-policy comparator, with more compute and licensing conditions than the first-stage shortlist. It is not a proven invoice-authorization model. [Official model card](https://huggingface.co/nvidia/Nemotron-Content-Safety-Reasoning-4B).

## Proposed execution boundary

1. Scan untrusted customer/context/tool text and retain segment provenance. A benign prediction does not convert that text into a trusted instruction.
2. The planner proposes actions; deterministic application rules validate every action.
3. Optionally assess permitted proposals for semantic problems, such as an unsupported billing explanation or a tool call unrelated to the task. Return bounded, structured labels, not commands or revised permissions.
4. Hard policy violations remain blocked. Mandatory approvals remain mandatory. Observer findings can prioritize review or add an escalation within an explicitly configured autonomous scope.
5. Revalidate the current grant, receipt, invoice version, and trusted task before dispatch. Observers receive no tool credentials or operator approval capability.

A classifier cascade is a reasonable experiment: a cheap screen routes ambiguous material to a contextual model, with humans handling unresolved or required decisions. Anthropic describes a related cascade for jailbreak moderation, but its low overhead relies on internal activation probes that APX cannot obtain from an external model API. Its results are architectural evidence, not a performance estimate for our stack. [Constitutional Classifiers++ research](https://www.anthropic.com/research/next-generation-constitutional-classifiers).

## Hosting and failure behavior

The application runs on Cloudflare Workers. Workers have a 128 MB isolate memory limit. Original Meta checkpoints are approximately 283 MB for the 22M-named variant and 1.12 GB for the 86M-named variant, before runtime memory. Plan a separate inference process or service; do not bundle these checkpoints directly into the current Worker. Quantization may change size and behavior and must be evaluated as a distinct configuration. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/), [22M files](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-22M/tree/main), [86M files](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M/tree/main).

Keep the service warm for latency experiments and include network delay, queueing, and cold starts in total measurements. Enforce deadlines, bounded inputs, authenticated service access, pinned revisions, and redacted diagnostics. In shadow mode, a timeout records unavailable evidence without affecting existing decisions. If a future automatic execution mode depends on observer evidence, missing/malformed evidence must route to review; it must not manufacture approval.

## Build-test-fix experiment

1. **Shadow mode:** log predictions and timings without changing dispatch. Use the current 29 authored cases only as development fixtures, not an unseen benchmark. The previous keyword heuristic is not a pretrained model and its result does not predict these models' performance.
2. **Matched trials:** compare rules alone, rules plus each injection classifier, and rules plus a classifier/contextual-observer cascade on the same tasks and proposals. Keep trust profile and mandatory approval requirements identical.
3. **Held-out inputs:** independently label normal support requests, quoted attacks, Hindi/mixed-language text, hidden instructions in structured data, long inputs, chunk-boundary attacks, unsupported reply facts, mixed safe/unsafe plans, and adaptive attacks targeting the observer itself. Partition by attack family/template to reduce leakage; use public benchmarks as supplemental evidence with possible training contamination disclosed.
4. **Measure separately:** missed attacks, false escalations, legitimate task completion, unauthorized effects committed, reviews per completed task, actual operator review time, p50/p95 end-to-end latency, warm/cold inference latency, memory, and cost. Model scores are not calibrated proof of safety; threshold tuning belongs to the development split.
5. **Promotion:** agree on workload-specific error and latency budgets before examining held-out results. Report uncertainty and failure examples. Zero observed violations is not proof of zero risk. If no configuration improves a useful metric within the error budget, keep the observer advisory or remove it.

For a resume, the valuable result would be a reproducible measurement of the security, usefulness, review workload, and latency tradeoff. Adding an existing guard model alone is not a unique contribution. Any review-time or attack-reduction claim must wait for measured results.
