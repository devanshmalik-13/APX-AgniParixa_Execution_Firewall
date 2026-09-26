# AgentShield

AgentShield is a runtime security boundary for tool-using AI agents. It assumes the model can be manipulated and evaluates every consequential tool request against a trusted task definition before execution.

The included demo replays three attacks against a fictional workplace assistant:

1. Indirect prompt injection leading to secret exfiltration.
2. Persistent memory poisoning that changes authorization.
3. A runaway agent loop that exceeds its execution budget.

The same attack can be run in `unprotected`, `observe`, and `enforce` modes. Every decision produces a structured audit record with evidence and an explainable risk score.

## Why this is not another prompt filter

Prompt injection does not have a universal text-classification fix. AgentShield therefore controls impact at the tool boundary:

- Untrusted retrieved text is data, not authority.
- Tools are limited by the currently assigned task.
- Task relevance is one policy signal, never the only security control.
- Sensitive information cannot leave through an unauthorized destination.
- Security-related memory writes from untrusted sources are blocked.
- Iteration budgets contain runaway execution.

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

Evaluation set: 11 deterministic cases, executed locally against the policy engine.

| Metric | Result |
| --- | ---: |
| Malicious cases | 6 |
| Attacks blocked or contained | 5 |
| Defense rate | 83.3% |
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
lib/security/secret-scanner.ts   direct and encoded secret checks
lib/security/scenarios.ts        three headline attack fixtures
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

The engine returns `allow`, `approval_required`, `observe`, or `block`, plus machine-readable findings. Hard policies take priority over aggregate scores.

## Threat model and limitations

See [THREAT_MODEL.md](./THREAT_MODEL.md). AgentShield does not claim to eliminate prompt injection. Model-weight attacks, training-time poisoning, unknown encoding schemes, and tools that operate outside the gateway are out of scope for this prototype.

All data, secrets, recipients, tools, and attacks in this repository are fictional and owned by the demo environment.
