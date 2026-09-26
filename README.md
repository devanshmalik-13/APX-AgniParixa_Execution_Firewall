# AgentShield

AgentShield is a SOC decision-support and runtime security boundary for tool-using AI agents. It does not replace the analyst: it collects evidence, prioritizes risk, stages a reversible response, and requires a human decision for uncertain or novel behavior.

## Hackathon build and AI disclosure

This project was started from zero during the hackathon on 26 September 2026. It is not a reskin or continuation of an existing project.

OpenAI Codex with the GPT-6 Sol model was used as an AI coding assistant for research, project scaffolding, implementation, interface design, tests, security evaluation fixtures, and documentation. The team supplied the product direction, requirements, security decisions, and review feedback. The initial framework scaffold was created during the event through the Codex Sites workflow and then replaced with the AgentShield implementation.

Open-source dependencies include React, Vinext/Next-compatible tooling, Tailwind CSS, Lucide React, Radix UI, and the testing/build packages declared in `package.json` and `package-lock.json`.

All identities, messages, customer records, secrets, tools, recipients, and attacks are synthetic. Security testing is restricted to this repository's mock sandbox. The demonstration does not access real personal, patient, organizational, or third-party data.

The included demo replays six attacks against a fictional workplace assistant:

1. Indirect prompt injection leading to secret exfiltration.
2. Persistent memory poisoning that changes authorization.
3. A runaway agent loop that exceeds its execution budget.
4. An unknown attack shape with no matching signature, detected through behavior drift.
5. A forbidden shell capability requested by untrusted content.
6. A consequential prompt that tries to hijack the agent beyond its assigned task.

The same attack can be run in `unprotected`, `observe`, and `enforce` modes. Every decision produces a structured audit record with evidence and an explainable risk score.

## Why this is not another prompt filter

Prompt injection does not have a universal text-classification fix. AgentShield therefore controls impact at the tool boundary:

- Untrusted retrieved text is data, not authority.
- Tools are limited by the currently assigned task.
- Task relevance is one policy signal, never the only security control.
- Sensitive information cannot leave through an unauthorized destination.
- Security-related memory writes from untrusted sources are blocked.
- Iteration budgets contain runaway execution.
- Behavior Drift compares tool sequences, argument shapes, destinations, and sensitive-data fan-in with a known-safe baseline. Novelty requests analyst review; it is not treated as proof of maliciousness.
- Routine actions are allowed automatically and hard policy violations are contained automatically. Only the uncertain middle is sent to an analyst.
- Novel-behavior approvals are limited to one action, expire after five minutes, and cannot expand the original data scope.
- Containment is staged with scoped-token revocation, evidence preservation, and rollback.

The model proposes actions. AgentShield makes the authorization decision.

## Run locally

Requirements: Node.js 22.13 or later.

```bash
npm ci
npm run dev
```

Open the local URL printed by the development server.

## Verification

```bash
npm test
npm run evaluate
npm run build
```

`npm test` verifies the policy engine and secret scanner. `npm run evaluate` executes the documented attack and legitimate-request set and prints measured misses and false positives.

## Current measured result

Evaluation set: 13 deterministic cases, executed locally against the policy engine.

| Metric | Result |
| --- | ---: |
| Malicious cases | 8 |
| Attacks blocked or contained | 7 |
| Defense rate | 87.5% |
| Known bypasses | 1 |
| Legitimate cases | 5 |
| False positives | 1 |
| False-positive rate | 20% |

### Known bypass

An attacker can encode a secret using an unsupported semantic code (the fixture uses ROT13-like text) while making the action appear relevant. The current deterministic scanner does not understand the hidden meaning, so the request is allowed.

### Known false positive

A legitimate customer reply containing confidential billing information is blocked when the customer destination is not explicitly approved. Production deployment would need scoped, time-bound recipient authorization or human approval.

These numbers measure only the included documented cases. They are not a general security guarantee.

## Project structure

```text
app/page.tsx                     interactive attack-replay interface
lib/security/types.ts            trust, task, action and audit types
lib/security/policy-engine.ts    deterministic authorization policies
lib/security/novelty-detector.ts behavior-drift detection for unknown attacks
lib/security/secret-scanner.ts   direct and encoded secret checks
lib/security/scenarios.ts        six headline attack fixtures
lib/security/evaluation.ts       attack and legitimate-request evaluation set
tests/policy-engine.test.ts      security regression tests
THREAT_MODEL.md                  attacker, assets, boundaries and exclusions
```

## Security design

Each proposed action includes:

- Its requested tool and arguments.
- The trusted task it is supposed to support.
- A relevance score for that task.
- Data lineage describing the source, trust level, and sensitivity of influencing data.
- Destination, execution-budget, and memory-impact metadata when applicable.
- An optional behavior fingerprint for detecting unseen execution patterns without an attack signature.

The engine returns `allow`, `approval_required`, `observe`, or `block`, plus machine-readable findings. Hard policies take priority over aggregate scores. `approval_required` is deliberately human-in-the-loop: AgentShield recommends containment but the SOC analyst owns the decision.

## Design references

- [OWASP's Agentic AI guidance](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/) recommends goal-consistency validation, anomaly detection on decision workflows, and risk-prioritized human review.
- [Microsoft's Security Copilot guidance](https://learn.microsoft.com/en-us/copilot/security/rai-faqs-security-copilot-agents) describes SOC copilots as triage and investigation aids that provide transparent reasoning and guided response so analysts can review and override conclusions.

These references informed the product direction; the policy engine, fixtures, evaluation, and interface in this repository were implemented during the hackathon.

## Threat model and limitations

See [THREAT_MODEL.md](./THREAT_MODEL.md). AgentShield does not claim to eliminate prompt injection. Model-weight attacks, training-time poisoning, unknown encoding schemes, and tools that operate outside the gateway are out of scope for this prototype.

All data, secrets, recipients, tools, and attacks in this repository are fictional and owned by the demo environment.
