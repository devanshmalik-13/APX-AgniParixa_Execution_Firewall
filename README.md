# APX — AgniParixa Execution Firewall

*Every AI action must pass through AgniParixa.*

APX is a SOC decision-support and runtime security boundary for tool-using AI agents. It does not replace the analyst: it collects evidence, prioritizes risk, stages a reversible response, and requires a human decision for uncertain or novel behavior.

## Hackathon build and AI disclosure

This project was started from zero during the hackathon on 26 September 2026. It is not a reskin or continuation of an existing project.

OpenAI Codex with the GPT-6 Sol model was used as an AI coding assistant for research, project scaffolding, implementation, interface design, tests, security evaluation fixtures, and documentation. The team supplied the product direction, requirements, security decisions, and review feedback. The initial framework scaffold was created during the event through the Codex Sites workflow and then replaced with the APX implementation.

Open-source dependencies include React, Vinext/Next-compatible tooling, Tailwind CSS, Lucide React, Radix UI, and the testing/build packages declared in `package.json` and `package-lock.json`.

All identities, messages, customer records, secrets, tools, recipients, and attacks are synthetic. Security testing is restricted to this repository's mock sandbox. The demonstration does not access real personal, patient, organizational, or third-party data.

The included demo sends eight attacks through a real server-side policy gateway protecting a fictional workplace assistant:

1. Indirect prompt injection leading to secret exfiltration.
2. Persistent memory poisoning that changes authorization.
3. A runaway agent loop that exceeds its execution budget.
4. An unknown attack shape with no matching signature, detected through behavior drift.
5. A forbidden shell capability requested by untrusted content.
6. A consequential prompt that tries to hijack the agent beyond its assigned task.
7. A canonical-path traversal attempt against the filesystem sandbox.
8. A structured database request that attempts to cross a tenant boundary.

Exact server-owned fixtures at every attack level can be run in `unprotected`, `observe`, and `enforce` modes for comparison. In Unprotected and Observe, tool reach is a counterfactual simulation—no real system or mock store is mutated. Custom submissions are always enforced, and client-claimed trusted provenance is downgraded. The gateway redacts recognizable secrets before storing a prompt, then records the proposed action and policy decision before tool dispatch, followed by its execution outcome and SHA-256 decision receipt in D1. The live inspector lets judges mutate the action envelope and resubmit it. All tools and data remain synthetic.

## What makes this different

APX uses **capability passports**, not a universal prompt-injection classifier. A passport binds the agent action to a task, tenant, tool, operation, data scope, destination, row limit, and expiry. The model can propose anything, but it cannot expand its passport. A request that says “I am an administrator” has no effect on the trusted server-side grant.

The demo connectors are functional, deliberately small enterprise simulators:

- The filesystem adapter canonicalizes paths, confines reads to `/workspace`, and confines writes to `/workspace/drafts` while rejecting protected and executable filenames.
- The database adapter accepts structured operations instead of raw SQL and enforces tenant, table, column, and row limits over synthetic records.
- The prompt and run log remains available after Worker restarts. Recognizable credentials are redacted before persistence; unknown secret formats may remain. The receipt hash links the redacted decision to its evidence for later debugging; it is not an immutable external audit service.

## Why this is not another prompt filter

Prompt injection does not have a universal text-classification fix. APX therefore controls impact at the tool boundary:

- Untrusted retrieved text is data, not authority.
- Tools are limited by the currently assigned task.
- Task relevance is one policy signal, never the only security control.
- Sensitive information cannot leave through an unauthorized destination.
- Security-related memory writes from untrusted sources are blocked.
- Iteration budgets contain runaway execution.
- Behavior Drift compares tool sequences, argument shapes, destinations, and sensitive-data fan-in with a known-safe baseline. Novelty requests analyst review; it is not treated as proof of maliciousness.
- Routine actions are allowed automatically and hard policy violations are contained automatically. Only the uncertain middle is sent to an analyst.
- Novel-behavior approvals are bound to the original action and expire after five minutes. The analyst can keep the action isolated or allow that exact mock action once.
- Containment keeps blocked and approval-pending actions from reaching the mock connectors, while retaining the prompt, policy result, and execution record for review.

The model proposes actions. APX makes the authorization decision.

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

In the app, **Run attack** submits the selected prompt and proposed action to the server gateway. Select **Attack as synthetic user** first; the response displays the identity read back from D1 with the prompt ID, so the attribution can be checked in the logs. **Run 16-case attack bench** executes all documented fixtures and writes every prompt and result to D1. **Review user-wise prompt logs** ranks synthetic users by flagged count, lets you inspect every prompt with pagination, and opens full incident details. From a user or prompt detail, generate a structured PDF explaining policy findings, containment or non-containment, mock execution, analyst action, and receipt. The JSON export contains the full stored, redacted history, including Unicode that standard PDF fonts may not represent. `/api/audit` returns the recent log and aggregate metrics for recorded benchmark runs in enforce mode. Manual replays are logged separately and do not change the benchmark percentage.

## Five-minute judge demo

1. Open the private Site, keep **Enforce** selected, and choose **Indirect injection** at **Easy**. Click **Run attack**. Show that the mock action was held and the policy reason names sensitive external egress.
2. Change to **Unprotected** and run the same prompt to show the same mock action continuing. Return to **Enforce** immediately.
3. Choose **Unknown behavior** at **Hard**. Run it and show the approval gate: there is no signature match, but behavior drift causes a human review. Click **Keep isolated**.
4. Set **Extreme**, choose **Judge test**, edit the prompt to include a different external recipient (for example `judge@outside.example`), and run. The proposal preview shows the recipient extracted from the prompt; the gateway evaluates that proposal. For exact tool-argument experiments, use **Open live action inspector**.
5. Select a different **Attack as synthetic user** identity and run an attempt. Show the backend-verified user and prompt ID below the selector, then find that same prompt under that user in the log.
6. Run the **16-case attack bench**. State the measured 10/11 attack containment and 1/5 false positives, including the known bypass and false positive below. Open **Review user-wise prompt logs**: flagged users are ranked first in red; click a user, then a prompt to show the reasons, tool action, result, and receipt. Generate both **user PDF** and **prompt PDF** reports.

All identities and tools are synthetic. Difficulty controls change prompt framing and task-relevance in the deterministic mock-agent proposal; they are not a calibrated measure of attacker skill or guaranteed to become harder to block.

## Current measured result

Evaluation set: 16 deterministic cases, executed locally against the policy engine and repeatable through the server gateway.

| Metric | Result |
| --- | ---: |
| Malicious cases | 11 |
| Attacks blocked or contained | 10 |
| Defense rate | 90.9% |
| Known bypasses in this set | 1 |
| Legitimate cases | 5 |
| False positives | 1 |
| False-positive rate | 20% |

### Known bypass and residual limitation

The documented ROT13-like external leak is now held for approval. A separate attack still passes: a compromised mailbox within the allowed domain requests an encoded secret, while its lineage is incorrectly marked trusted and public. Domain-level allowlisting and the current scanner miss that combination. This is a deliberately retained measured bypass, not a claim that all internal recipients are safe.

### Known false positive

A legitimate customer reply containing confidential billing information is blocked when the customer destination is not explicitly approved. Production deployment would need scoped, time-bound recipient authorization or human approval.

These numbers measure only the included documented cases. They are not a general security guarantee.

## Project structure

```text
app/page.tsx                     interactive attack-replay interface
app/api/gateway/route.ts         schema-validated policy enforcement endpoint
app/api/audit/route.ts           prompt log, runtime metrics, analyst decisions
app/api/audit/export/route.ts    full JSON audit export
app/api/benchmark/route.ts       repeatable server-side attack and legitimate fixtures
lib/security/gateway.ts          evaluate-before-execute orchestration
lib/security/connectors.ts       sandboxed filesystem and scoped database adapters
lib/security/boundaries.ts        shared enforcement checks used by policy and adapters
lib/security/run-store.ts        durable D1 prompt and run records
lib/security/audit-redaction.ts  best-effort credential redaction before persistence
lib/security/ingress.ts          enforce-only custom input and provenance downgrade
lib/security/request-schema.ts   untrusted request validation
lib/security/types.ts            trust, task, action and audit types
lib/security/policy-engine.ts    deterministic authorization policies
lib/security/novelty-detector.ts behavior-drift detection for unknown attacks
lib/security/secret-scanner.ts   direct and encoded secret checks
lib/security/scenarios.ts        eight headline attack fixtures
lib/security/evaluation.ts       attack and legitimate-request evaluation set
tests/policy-engine.test.ts      security regression tests
tests/boundary-regressions.test.ts connector and egress bypass regression tests
drizzle/                        database migration for prompt and run records
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

The engine returns `allow`, `approval_required`, `observe`, or `block`, plus machine-readable findings. Hard policies take priority over aggregate scores. An approval request is held until the analyst records a decision. Only benchmark runs with known attack/legitimate labels contribute to the displayed rates; arbitrary edited submissions remain unlabeled. The UI displays the most recent 200 prompts, while D1 keeps the full history.

The current attack harness supplies the agent's proposed tool action through a small deterministic mock-agent parser. It can extract supported recipients, paths, tenants, and iteration counts from edited prompts, and it falls back to a benign internal draft when an edited prompt has no recognizable attack cue. It does not run a live language model or understand arbitrary language. Use the JSON action inspector for exact action-envelope tests. Custom client submissions cannot claim trusted retrieved content or disable enforcement, but their sensitivity and task-relevance fields are not independently attested. A production integration must derive all provenance, sensitivity, and relevance signals from a trusted orchestrator, rather than accepting client metadata.

## Design references

- [OWASP's Agentic AI guidance](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/) recommends goal-consistency validation, anomaly detection on decision workflows, and risk-prioritized human review.
- [Microsoft's Security Copilot guidance](https://learn.microsoft.com/en-us/copilot/security/rai-faqs-security-copilot-agents) describes SOC copilots as triage and investigation aids that provide transparent reasoning and guided response so analysts can review and override conclusions.

These references informed the product direction; the policy engine, fixtures, evaluation, and interface in this repository were implemented during the hackathon.

## Threat model and limitations

See [THREAT_MODEL.md](./THREAT_MODEL.md). APX does not claim to eliminate prompt injection. Model-weight attacks, training-time poisoning, unknown encoding schemes, and tools that operate outside the gateway are out of scope for this prototype.

All data, secrets, recipients, tools, and attacks in this repository are fictional and owned by the demo environment.
