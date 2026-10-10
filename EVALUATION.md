# Current support-workspace evaluation — 10 October 2026

The new support workspace has **158 passing automated tests** across the complete repository, including 31 support-policy tests, 9 provider-loop/replay tests and 19 durable SQLite transaction tests. The randomized policy test exercises 250 seeded mixed-action batches.

| Check | Measured result |
| --- | --- |
| TypeScript | Pass |
| Support action-policy fixtures | 20/20 cases match ground truth |
| Unsafe supplied proposals authorized | 0/15 |
| Legitimate supplied actions blocked | 0/9 |
| Real HTTP/D1 integration groups | 7/7 pass; 10 staged plans per run |
| Browser workflow | Sign-in, preview, strict approval, execute, recover, evidence download and mobile layout verified |
| Original attack-lab HTTP/PDF/export checks | Pass |
| Live model request | Not run: no configured server API key |

Artifacts: `output/support-evaluation.json`, `output/support-http-check.json`, `output/support-live-check.json`. Reproduce with `npm test`, `npm run evaluate:support`, `npm run check:support` and `npm run check:live`. The live check explicitly exits 2 with `status: not_run` when unavailable. Current build and architecture details are in [SUPPORT_ENGINEERING.md](./SUPPORT_ENGINEERING.md).

The support evaluation supplies explicit action fixtures to the authorization engine. It does not measure a model's susceptibility to prompt injection, production task success, external payment/email rollback, or general security. Scripted provider tests validate orchestration independently of real model behavior. HTTP tests verify persisted effects and recovery; their synthetic audit records remain after cleanup.

---

# Historical attack-lab evaluation report

Date: 2026-09-26  
Policy: default APX policy  
Mode: enforce  
Execution: deterministic local fixtures

## Results

- 16 total cases
- 11 malicious cases
- 11 malicious cases blocked or contained
- 0 successful bypasses
- 100% defense rate on this documented set
- 5 legitimate cases
- 0 legitimate cases blocked
- 0% false-positive rate

## Attacks represented

- Indirect prompt injection through a retrieved support ticket
- Secret exfiltration to an unauthorized recipient
- Persistent authorization-memory poisoning
- Unbounded agent/tool loop
- Out-of-scope shell-tool escalation
- Off-task goal hijacking through a consequential user prompt
- External prompt pivot
- Obfuscated semantic secret leakage
- Unknown attack shape detected through tool-sequence and data-flow novelty
- Canonical filesystem path traversal outside the sandbox root
- Cross-tenant structured database access

## Failure analysis

### Closed test bypass: semantic-secret-bypass

The original egress contained an encoded phrase not recognized by the deterministic scanner. The scanner now recognizes the documented ROT13-like encoding, and unknown external destinations independently reach the approval threshold. The test is therefore contained even if one of those controls fails.

### Closed bypass: internal-recipient-bypass

A compromised internal mailbox requests an encoded mock secret with incorrectly trusted/public lineage. The task now grants individual SOC and analyst mailboxes instead of the full internal domain, so this fixture is held for approval even when scanning misses the encoding. It is unchanged from the original measured bypass.

### Corrected false positive: benign-authorized-customer-reply

The server task now contains a scoped grant for sending billing-record-42 to customer@example.test. The unchanged legitimate fixture passes; different sources, recipients, operations, and secret credentials are still denied. This grant shares the task expiry. Source attestation remains a production integration requirement.

## Reproduce

```bash
npm run evaluate
# With npm run dev running on localhost:5173 (adds synthetic audit records):
npm run check:local
```

The command prints the summary and complete failure records. Changes to policy or fixtures should be accompanied by a fresh report.

Additional regression tests cover recipient-field conflicts, a recipient supplied only in tool arguments, protected filesystem writes, path traversal, and database table-name abuse. These tests are separate from the fixed 16-case benchmark, so the reported percentages keep the same denominator.

The dashboard's **Run 16-case attack bench** sends the same fixtures through the server gateway and stores each prompt, decision, and mock tool outcome in D1. The live percentage uses recorded benchmark runs in enforce mode. Manual replays are logged but excluded from that denominator. An analyst's one-time approval can change a benchmark run's final execution outcome, so live rates can differ from the untouched local fixture report.
