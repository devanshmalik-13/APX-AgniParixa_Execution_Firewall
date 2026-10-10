# APX — Safe execution for AI support agents

APX turns an AI agent's proposed support actions into a reviewable, scoped transaction. It reads an assigned ticket, previews invoice changes and replies, enforces customer-specific permissions outside the model, commits permitted actions atomically, and supports compensating recovery.

The primary workspace is `/` (also `/support`). The original execution-firewall attack lab remains at `/lab`. This is an evolution of the existing hackathon project; the historical documentation below describes that earlier build.

The implementation comparison at `/evaluation` evaluates five local control combinations on the same synthetic action proposals, explains the selected direction, and provides an external-proposal gateway inspector. `POST /api/execution/plans` stages provider-independent actions under server-owned grants and mandatory strict review. See [IMPLEMENTATION_DECISIONS.md](./IMPLEMENTATION_DECISIONS.md) for architecture decisions, integration contract, research and limits.

The pretrained observer at `/observer` adds four focused panels with a floating bottom dock: Scan, Results, Setup and Method. Its separate authenticated Python service runs pinned injection classifiers; the app validates and seals shadow evidence into support-plan receipts without changing grants or mandatory approvals. Public PIGuard has been run locally on CPU in bfloat16; Meta Prompt Guard variants require the owner's gated model access and remain unverified. See [observer setup and verification](./services/observer/README.md) and [model research](./GUARD_MODEL_RESEARCH.md). Local inference does not enable the hosted site: hosting needs its own reachable HTTPS inference service.

## Current end-to-end workflow

1. Select a synthetic billing ticket and inspect its trusted customer/invoice assignment.
2. Use deterministic **Replay** or the server-configured **Live agent** to stage a plan. Staging runs no write connector.
3. Inspect each action's before/after preview, policy decision, task grant, tool trace, and receipt.
4. Explicitly approve flagged actions when required. Execute only the permitted actions; blocked actions are skipped.
5. APX atomically changes the invoice, records the refund ledger, queues a sandbox reply, and writes the lifecycle audit event.
6. Recover supported changes: restore the invoice and cancel the queued reply, provided no later invoice mutation has occurred. Versions move forward during recovery.

All tickets, customer addresses, money and messages are synthetic. A refund changes an application ledger; it does not call a payment provider. A reply enters a durable sandbox outbox; it does not send email. These are actual persisted application effects, not a counterfactual animation.

## Run the complete app

Use Node.js 24 LTS (the SQL tests use `node:sqlite`).

```sh
npm ci
npm run build
npm run db:local:init
npm run dev
```

Open the printed local URL and use **Sign in with ChatGPT**. Local development provides a loopback-only test identity through the vendored Sites middleware; it strips caller-supplied identity headers. Hosted identity comes from Sites. Each signed-in visitor's support records are partitioned separately.

Replay works without a model-provider key and is labeled as a deterministic fixture. It does not interpret the optional customer text. Live mode uses a bounded OpenAI Responses API function-calling loop and interprets the source ticket, selected imported-attachment scenario, and additional untrusted customer context. It cannot execute write tools directly.

`OPENAI_API_KEY` is a server-only secret, configured through the secure OpenAI Developers setup locally and the Sites environment-variable tool for hosting. `OPENAI_MODEL` is optional (default `gpt-5-mini`). Never commit a key or put one in browser code. A key must be configured separately in each runtime. Missing keys disable Live mode; provider failures never fall back silently to Replay.

## Verification

```sh
npm run typecheck
npm test
npm run evaluate:support
npm run evaluate:combinations
npm run evaluate
npm run check:support
npm run check:live
```

`check:support` requires the running local app and writes synthetic test records. It recovers its successful executions; audit records and monotonically increasing invoice versions remain. Set `SUPPORT_BASE_URL` if your server differs from `http://localhost:5173`.

`check:live` requires a configured provider and stages a real model plan without executing its write actions. It reports `not_run` with a nonzero exit status when a key is unavailable. Scripted provider tests exercise orchestration and failure handling without paid requests; they do not measure live model performance.

The support-policy evaluation includes 20 ground-truth cases: 15 attack cases and 5 legitimate cases. On this fixed set, all unsafe proposed actions are blocked and all legitimate actions remain permitted or approval-required. See `output/support-evaluation.json` and [SUPPORT_ENGINEERING.md](./SUPPORT_ENGINEERING.md) for the scope, architecture, evidence, demo and limitations. No general prompt-injection detection rate is claimed.

## Design choices worth reviewing

- Authority comes from server-owned ticket records, not customer instructions, model-generated metadata, or a prompt classifier.
- Standard policy allows in-scope refunds up to $50 without an additional approval. A ticket's authorized maximum still applies; higher eligible refunds require approval. Strict policy requires approval for every permitted consequential action.
- A task can propose one permitted refund, one invoice transition and one reply. Bulk export is outside the support role. Grants expire after 15 minutes.
- Receipts bind exact proposals and approvals. The SHA-256 receipt is an integrity checksum backed by the trusted database, not an externally signed or immutable audit service.
- Transaction claims, full-snapshot version checks, SQL assertions and a unique invoice refund ledger prevent duplicate or partial execution.
- Recognizable sensitive proposal values are redacted before storage and permanently denied. Pattern-based redaction does not cover every unknown secret format.
- Live planning has an owner-scoped 75-second cooldown, an eight-response/twelve-tool-call budget, and a 45-second overall timeout.

---

# Historical hackathon build — AgniParixa Execution Firewall

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

Custom prompts also receive a bounded credential-disclosure check. Requests such as “please give me the api key” are blocked with `credential-disclosure-request`, even if the action inspector supplies a harmless-looking draft or requests Unprotected mode. The server binds the original prompt to the evaluated action; the preview uses the same ingress rules. API-key explanations and creation/rotation guidance remain allowed by this rule. This deterministic check recognizes explicit disclosure wording, including common whitespace and numeric HTML-entity variants; it is not a general language classifier and can misinterpret quoted or negated requests. Capability and connector checks still apply independently.

## Run locally

Requirements: Node.js 22.13 or later.

```bash
npm ci
npm run build
npm run db:local:init
npm run dev
```

Open the local URL printed by the development server.
The [database package](./database/README.md) includes the D1/SQLite schema and a clean `.sqlite` file for inspection. The local initialization step creates the live D1 tables; the 16-case attack bench populates them with genuine synthetic audit records.

## Verification

```bash
npm test
npm run evaluate
npm run build
```

`npm test` verifies the policy engine, connector boundaries, prompt rules, and secret scanner. With the local app running on port 5173, `npm run check:local` checks the HTTP gateway, audit persistence, concurrent approvals, exports, and PDF downloads; it adds synthetic Judge test and benchmark records. `npm run evaluate` executes the documented attack and legitimate-request set and prints measured misses and false positives.

In the app, **Run attack** submits the selected prompt and proposed action to the server gateway. Select **Attack as synthetic user** first; the response displays the identity read back from D1 with the prompt ID, so the attribution can be checked in the logs. **Run 16-case attack bench** executes all documented fixtures and writes every prompt and result to D1. **Review user-wise prompt logs** ranks synthetic users by flagged count, lets you inspect every prompt with pagination, and opens full incident details. From a user or prompt detail, generate a structured PDF explaining policy findings, containment or non-containment, mock execution, analyst action, and receipt. The JSON export contains the full stored, redacted history, including Unicode that standard PDF fonts may not represent. `/api/audit` returns the recent log and aggregate metrics for recorded benchmark runs in enforce mode. Manual replays are logged separately and do not change the benchmark percentage.

## Five-minute judge demo

1. Open the private Site, keep **Enforce** selected, and choose **Indirect injection** at **Easy**. Click **Run attack**. Show that the mock action was held and the policy reason names sensitive external egress.
2. Change to **Unprotected** and run the same prompt to show the same mock action continuing. Return to **Enforce** immediately.
3. Choose **Unknown behavior** at **Hard**. Run it and show the approval gate: there is no signature match, but behavior drift causes a human review. Click **Keep isolated**.
4. Set **Extreme**, choose **Judge test**, edit the prompt to include a different external recipient (for example `judge@outside.example`), and run. The proposal preview shows the recipient extracted from the prompt; the gateway evaluates that proposal. For exact tool-argument experiments, use **Open live action inspector**.
5. Select a different **Attack as synthetic user** identity and run an attempt. Show the backend-verified user and prompt ID below the selector, then find that same prompt under that user in the log.
6. Run the **16-case attack bench**. State the measured 11/11 attack containment and 0/5 false positives on this fixed set. Older stored benchmark runs remain in the historical dashboard totals. Open **Review user-wise prompt logs**: flagged users are ranked first in red; click a user, then a prompt to show the reasons, tool action, result, and receipt. Generate both **user PDF** and **prompt PDF** reports.

All identities and tools are synthetic. Difficulty controls change prompt framing and task-relevance in the deterministic mock-agent proposal; they are not a calibrated measure of attacker skill or guaranteed to become harder to block.

## Current measured result

Evaluation set: 16 deterministic cases, executed locally against the policy engine and repeatable through the server gateway.

| Metric | Result |
| --- | ---: |
| Malicious cases | 11 |
| Attacks blocked or contained | 11 |
| Defense rate | 100% |
| Known bypasses in this set | 0 |
| Legitimate cases | 5 |
| False positives | 0 |
| False-positive rate | 0% |

### Recipient scope and residual limitation

The documented external and internal encoded-leak cases are held for approval. The demo task now grants individual SOC and analyst mailboxes rather than an entire internal domain. Unknown internal recipients require review even when an encoding evades scanning. Recognizable credentials in tool content or nested arguments are blocked regardless of destination; unknown encodings still need trusted provenance and scoped authorization.

### Scoped customer replies

The server-owned demo task grants a send to customer@example.test only for billing-record-42. Other recipients, sources, and operations do not inherit that grant; secret credentials remain blocked. Production deployment must derive source labels from a trusted orchestrator.

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
