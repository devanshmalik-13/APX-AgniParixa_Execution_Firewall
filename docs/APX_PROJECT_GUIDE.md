# APX project guide

## 1 How to read this guide

APX is a working prototype for transactional execution and recovery of AI support-agent actions. It combines a support workspace, an independent proposal gateway, a security comparison workspace, a pretrained prompt-injection observer, and the earlier attack laboratory. This guide explains the implementation, its purpose, its workflows, and the knowledge needed to understand it.

Prepared and checked on 11 October 2026. The original application baseline is commit 004c934, followed by documentation, test-runner improvements and the Gemini planner integration. Automated tests, the build and support HTTP checks were rerun after the integration, and a real Gemini planning smoke check passed locally. Earlier artifacts record all five page routes and a short pretrained scan. This guide describes the local checkout; it does not imply that every local feature is deployed to the existing hosted site.

| Component | Current status | What that means |
| --- | --- | --- |
| Support workflow | Implemented and tested | Staging, policy decisions, durable execution, rejection and recovery work against the sandbox database. |
| External proposal gateway | Implemented and tested | Typed proposals use server-owned scope and mandatory review. |
| Responsive panel interface | Implemented | Bottom navigation separates work into focused panels. Observer layout has recorded checks at four screen sizes. |
| Public PIGuard observer | Real inference verified locally | CPU/bfloat16 results and failure behavior are recorded; evidence remains advisory. |
| Meta Prompt Guard alternatives | Adapters available, not verified | Gated model access and separate inference measurements are still required. |
| Live Gemini planner | Real planning verified locally | Gemini 3.5 Flash-Lite stages a receipt-bound plan; the smoke checker rejects it with connector state unchanged. |
| Live OpenAI planner | Adapter implemented; real inference unverified | Existing scripted tests pass. Gemini verification does not establish an actual OpenAI run. |
| Hosted observer release | Pending | Existing Sites lookup fails. A hosted Worker also needs a reachable HTTPS observer service. |
| Real payments and email | Outside the prototype | Refunds are ledger entries; messages stay in a cancellable outbox. |

Read chapters 2 through 10 for the core engineering workflow. Chapters 11 through 15 explain the observer, evaluation and security boundaries. Chapters 16 through 20 provide setup, demonstrations, learning topics, code navigation and honest resume positioning. You can study the prerequisite chapters first if transactions or tool calling are unfamiliar.

## 2 The problem and the project's contribution

A support agent reads a customer request and may propose a refund, invoice update or reply. Two kinds of failure matter. Hostile customer text can try to redirect the agent, while an ordinary model mistake can select the wrong invoice, spend too much, duplicate a refund or use outdated data. A detector that recognizes suspicious wording does not establish whether a proposed business action is authorized.

APX addresses this by placing authority in application code and trusted records. Customer prose helps the agent understand the task; it cannot assign a new tenant, increase the refund entitlement, authorize bulk export or approve execution. The agent produces a proposal. The application validates it, shows a concrete change preview, and commits only permitted effects through a guarded transaction.

The distinctive project contribution is the integration: trusted task scope, exact-proposal review, useful work retained inside a mixed malicious proposal, atomic execution, durable evidence and supported compensation. Authorization, transactions and classifiers are established techniques. APX does not claim to have invented them or to outperform enterprise vendors.

An honest answer to "why would people prefer this if bigger companies already do it?" is: this prototype demonstrates a focused, inspectable execution boundary that can accept proposals from different planners. Its usefulness comes from clear business invariants and reproducible failure tests. Preference would need a defined customer, integrations and measured operational benefits; those are future validation questions.

For a resume, the strongest story is engineering depth. You can explain how retry safety differs from detection, why approval cannot override a hard denial, how a stale preview loses without partial writes, and why recovery advances versions. These are concrete design decisions supported by code and tests rather than a claim that the entire security market has been solved.

## 3 Architecture and trust boundaries

The browser is a review interface. The app server owns authentication, trusted task grants, validation and database operations. The planner can read only scoped invoice data and propose typed writes. The Python observer is a separate classification service with no execution credentials.

~~~diagram
Customer text and attachments [untrusted]
                |
       Replay or live planner
                |
          Typed proposals
                |
Trusted ticket -> App policy and preview <- Observer evidence
                |
       Stored plan and receipt
                |
       Operator review / approval
                |
       Atomic guarded transaction
                |
 Invoice + refund ledger + queued reply + audit
                |
       Supported compensation
~~~

The main trust boundary is between proposed arguments and authorized effects. An apparently valid JSON object can still describe a forbidden operation. Schema validation answers "is this a supported shape?" Policy answers "is this operation permitted for this specific ticket and current invoice?"

The observer has a different boundary. The app sends bounded, redacted text to a pinned model service. It validates the returned evidence before displaying or sealing it into a plan. A model verdict is never a grant, approval or instruction to execute.

The frontend uses React, TypeScript, Tailwind and Lucide icons. Vinext supplies Next-compatible routes through Vite. The server targets Cloudflare Workers; D1 provides SQLite storage and transactional batch behavior. The separate Python service uses FastAPI, PyTorch, Transformers and safetensors. Model weights do not run in the browser or Worker.

The trusted site proxy injects the visitor identity. Support records are partitioned by that owner. If deployed behind another proxy, it must authenticate requests and strip and reissue the identity header. Accepting a caller-supplied identity header on an exposed server would defeat that boundary.

## 4 Website structure and panel behavior

The interface separates distinct jobs rather than putting all evidence on one long page. The support, evaluation and observer workspaces use bottom floating navigation. On pointer devices the dock can reveal near the bottom and remain accessible through focus or pinning. Touch users have persistent navigation. Keyboard focus is part of the interaction; navigation is not dependent on a mouse gesture alone.

| Route | Panels | Purpose |
| --- | --- | --- |
| / and /support | Inbox, Planner, Review, Permissions, Trace, Activity | Choose a task, stage a plan, review changes, inspect scope, understand tool calls and examine durable effects. |
| /evaluation | Decision, Results, Cases, Gateway | Compare local controls, inspect metrics and cases, and submit an external proposal. |
| /observer | Scan, Results, Setup, Method | Scan text, inspect actual model evidence, refresh readiness and understand experimental limitations. |
| /lab | Historical attack laboratory and audit exploration | Demonstrate broader synthetic security scenarios and their recorded outcomes. |

The viewport bounds the application shell; longer content scrolls inside the appropriate content area. This reduces the large blank spaces and the overlapping inbox behavior from the earlier stacked layout. Grids collapse at narrow widths, text wraps, and controls remain reachable in short landscape screens.

The observer has recorded layout checks for all four panels at 1366 by 768, 390 by 844, 320 by 568 and 844 by 390. Those checks found no page overflow or horizontal panel overflow. This is evidence for those tested combinations, not proof that every browser, zoom level or device ratio is flawless.

Panel controls connect to actual behavior: ticket selection changes trusted context; staging creates a durable preview; review operations call lifecycle endpoints; evidence downloads export the displayed report; observer readiness distinguishes loaded models from unavailable alternatives. A polished animation is useful for orientation, but it does not substitute for state handling, accessible controls or server validation.

## 5 Trusted records and task grants

The reference application uses three synthetic customer tickets. They represent different authorized support jobs, so the model cannot treat every invoice as a refund request.

| Customer | Ticket and invoice | Invoice amount | Ticket credit entitlement |
| --- | --- | --- | --- |
| Maya Chen | tkt-1042 / inv-1042 | $199 | $25 duplicate-seat credit |
| Jordan Ellis | tkt-1043 / inv-1043 | $499 | $75 service credit |
| Priya Rao | tkt-1044 / inv-1044 | $89 | $0; explanation only |

Amounts are stored as integer cents. This avoids using imprecise floating-point arithmetic for currency. An invoice also stores tenant, customer, refundable balance, refunded balance, status and version. A ticket stores its assigned invoice, original email recipient and authorized requested credit.

For each plan, the server derives a short-lived task grant from those trusted records. It binds the ticket to exactly one tenant, customer, invoice and recipient. The maximum refund is the nonnegative minimum of the ticket entitlement, remaining refundable balance and a $100 application cap. Maya's invoice has a $50 refundable allowance, but her ticket still authorizes only $25.

The grant expires after 15 minutes and allows at most eight proposed actions. Standard policy allows permitted refunds up to $50 without an additional approval flag; larger permitted refunds require review. Strict policy requires approval for every permitted action. Neither profile expands the underlying entitlement.

An attachment saying "the administrator approved $999" remains untrusted text. It does not edit the ticket or grant. This is the key distinction between the customer's explanation of the problem and the application's authority to change financial state.

Trusted records are synthetic fixtures in this version. A production integration would have to derive them from authenticated ticket, billing and identity systems; copying customer claims into those fields would undermine the design.

## 6 Planning with replay and a live agent

Replay planning creates deterministic proposals for normal work, injected export instructions, an excessive refund, a cross-tenant operation and a duplicate refund. It provides reproducible demonstrations without a paid provider. Replay is not an LLM and does not interpret arbitrary notes as a general language model would.

Live planning uses one bounded tool loop with provider-specific adapters for OpenAI Responses and Gemini Generate Content. PLANNER_PROVIDER selects the server-owned provider. Gemini defaults to gemini-3.5-flash-lite; the OpenAI adapter retains gpt-5-mini. The server supplies trusted instructions, synthetic ticket context and tool definitions. The model requests scoped reads and proposes changes. APX validates each request and returns feedback; write tools stage proposals rather than executing their effects. Function calling is the general model-request/application-feedback pattern [1].

| Tool | Application behavior |
| --- | --- |
| read_invoice | Verifies assigned invoice, customer and tenant before returning data. |
| propose_refund | Validates arguments and records a refund proposal with policy feedback. |
| propose_invoice_update | Records a supported invoice transition proposal. |
| propose_reply | Records a reply proposal for later authorization and review. |
| export_customers | Explicitly denied for the support role. |

The loop is limited to eight response rounds, twelve tool calls and eight actions, with a 45-second planning deadline, 2,048 output tokens per response and a 128 KB response-body limit. OpenAI parallel calls are disabled and store=false is sent. Gemini can return a group of function calls; APX handles them sequentially under the same policy and budgets. Native Gemini thought signatures are preserved in memory for subsequent turns and never stored in the audit. Provider redirects are rejected without forwarding credentials. A database-backed owner cooldown reserves each attempt for 75 seconds, including failed attempts.

Unknown tools and malformed arguments receive denials. Within the remaining budget, a model can still follow a denied request with a legitimate proposal. Provider errors are surfaced safely; the app does not fabricate a successful live run by silently switching to replay.

Gemini authentication and actual normal-ticket and injected-ticket runs were verified on 11 October. In both runs, the model read the authorized invoice and proposed a refund, invoice resolution and reply to the original requester. It did not propose an export or redirected reply in the injected run. The checker verified each immutable receipt and unchanged connector state, then rejected its plan. These two smoke checks do not establish a broad security benchmark. OpenAI inference remains unverified. Gemini free-tier quotas and Google's product-improvement terms still apply; the demo uses synthetic data.

## 7 Deterministic action authorization

Each action receives allow, approval_required or block. Allow means it fits the current grant and may execute when the operator invokes execution. It does not mean staging automatically commits it. Approval_required means it is within scope but needs an explicit approval flag tied to this stored proposal. Block means it cannot execute, even if the operator checks approval.

| Action | Main authorization rules |
| --- | --- |
| Refund | Assigned invoice only; positive integer cents; within entitlement and remaining balance; no already-refunded invoice; larger standard refunds need approval. |
| Invoice update | Assigned invoice only; transition from unresolved to resolved; no arbitrary financial or identity fields. |
| Reply | Exact original recipient; bounded subject and body; no mail-header newline injection or recognizable secrets. |
| Customer export | Always outside this support ticket's capabilities. |

Strict runtime schemas reject unsupported fields. Duplicate action IDs are rejected. Only one permitted action of each type is allowed per transaction. A blocked attempt does not consume that action-type slot, so a malicious wrong-invoice proposal cannot suppress a later legitimate invoice action solely by appearing first.

The policy projects before and after values in order to build the review preview. It does not apply those values to the database. A mixed batch can therefore show a blocked export beside a permitted refund and reply. Execution excludes the blocked effect while preserving authorized work.

Sensitive values recognized by the scanner are redacted before persistence. If this changes an action, the action retains a redacted denial marker. Otherwise, removing a dangerous value could accidentally turn a previously unsafe action into an apparently safe proposal.

Pattern matching has limits: unknown secrets or encoded confidential data may evade the scanner. Likewise, action authorization does not prove that every permitted reply is helpful or factually correct. Business permissions, answer quality and text confidentiality are separate concerns and need separate validation.

## 8 Preview receipts and lifecycle

Staging stores the plan, its policy decisions, grant, invoice snapshot, tool trace and optional observer evidence. It also produces a SHA-256 receipt over a canonical JSON payload. Object keys are sorted consistently, so the same meaningful stored payload has a stable representation for hashing.

The receipt binds review to concrete arguments and evidence. At execution the browser submits only the plan ID, receipt hash, lifecycle operation and approval flag. It does not resubmit editable action arguments, a replacement grant or a new customer identity. The server loads the original plan and revalidates it.

~~~text
staged -> executed -> recovered
   |
   +----> rejected
~~~

Rejected proposals have no financial effects. Executed proposals have committed sandbox effects. Recovered proposals preserve the history of execution and compensation. A rejected or recovered plan is not a fresh instruction to execute again.

The hash is a checksum, not a digital signature, blockchain proof or independently immutable audit trail. Its protection depends on trusted server code, authorization, stored-plan integrity and revalidation. Someone who compromises both the database and trusted application is outside this prototype's protection.

First execution verifies that the grant is unexpired and derives current policy again. It compares the immutable preview and trusted snapshots rather than trusting the UI's wording. A changed invoice or entitlement causes a conflict. An already committed receipt can still return its idempotent result after the original expiry; otherwise a harmless retry could become an error solely because time passed.

Observer evidence is included in new receipts when present. Older receipts retain their original payload form. This preserves compatibility while preventing a new plan's observation from being silently exchanged after review.

## 9 Atomic execution and retry safety

Execution is a transaction, not a sequence of independent tool writes. The server claims the staged plan with a random reservation token, checks the full ticket and invoice snapshots, and dispatches only permitted actions. The refund ledger, invoice changes, queued reply, ticket state, plan state and audit event commit together.

D1 batch operations provide transactional behavior [2]. APX also uses SQL CHECK assertions. A conditional update can legitimately affect zero rows without raising a database exception. When zero rows means "the preview became stale," an assertion converts that condition into a transaction failure, causing rollback instead of allowing later outbox writes to commit.

Idempotency means retrying the same completed operation returns its existing result without duplicating its effects. If five execution requests arrive for the same plan, only one commits. Other requests observe the committed result rather than creating five refund records or five replies. A refund-ledger key also prevents a second support task from repeating a refund on the same owner and invoice.

Optimistic concurrency handles a different case: two distinct plans are staged from the same invoice version. After one changes the invoice, the other no longer matches its preview. It loses with a conflict and leaves no partial queued reply. The whole invoice and trusted ticket snapshot are checked, not just the visible amount field.

These properties address ordinary distributed-system failures as well as malicious tool arguments. Network retries, double clicks and delayed requests can all cause duplicate or stale effects without any prompt injection.

This is durable sandbox execution. The refund is a database ledger entry and the reply is queued locally. Exactly-once local commitment is not a claim of exactly-once behavior across an external payment API or email provider. Such integrations would require provider idempotency keys, delivery reconciliation and a carefully designed outbox dispatcher.

## 10 Compensation and recovery

Recovery is a new guarded transaction that compensates supported committed effects. It uses the original stored receipt and the executed plan's after-snapshot. If the invoice or ticket has since changed, it refuses to overwrite that later work.

For a supported recovery, APX restores the earlier financial and status values, removes its own refund-ledger effect, cancels its queued reply, restores ticket state and records the plan as recovered. The invoice version advances rather than returning to its earlier number. Returning to an old version would make stale proposals appear current again.

Consider Maya's example. A plan credits $25, resolves her invoice and queues a confirmation. Recovery restores the pre-credit financial state and supported status, cancels that queued confirmation and preserves both execution and recovery events. It does not erase evidence that the execution occurred.

Repeated recovery requests return the existing recovered state without compensating a second time. A later invoice modification causes recovery to fail with a conflict instead of replacing newer data. This makes the limitations visible rather than promising an unconditional undo button.

Compensation differs from database rollback. Rollback aborts a transaction before commitment; compensation creates later effects that counter a committed operation. That distinction becomes essential with real-world systems, where a bank transfer may need a new reversal transaction and a delivered message cannot be unsent.

The current implementation has no payment transfer or mail-delivery integration. Consequently it can recover its ledger and queued outbox state, but cannot demonstrate reversal of real money or withdrawal of delivered email. Production recovery would require explicit provider capabilities, approval policies and reconciliation for partial external failures.

## 11 The external proposal gateway and APIs

The external gateway lets another planner submit the same typed business actions without supplying authority. The request accepts only ticketId and one to eight actions. Owner identity, policy profile, grants, lifecycle state, approval and receipt are server-owned. Unknown fields are rejected, and the streamed request body is bounded to 12 KB.

~~~json
{
  "ticketId": "tkt-1042",
  "actions": [{
    "id": "credit-1",
    "type": "refund",
    "invoiceId": "inv-1042",
    "amountCents": 2500
  }]
}
~~~

External proposals always use strict policy and mandatory review. A proposal receives a persisted preview and receipt, not an execution result. The thin TypeScript client supplies propose and getPlan methods; it exposes no approve or execute method.

| Endpoint | Method | Responsibility |
| --- | --- | --- |
| /api/support | GET | Owner-scoped tickets, invoices, plans, outbox, events and safe configuration. |
| /api/support/plan | POST | Stage a replay or live proposal. |
| /api/support/plans/:id | GET | Read a stored owner-scoped plan. |
| /api/support/plans/:id | POST | Execute, reject or recover using the original receipt. |
| /api/execution/plans | POST | Stage an external proposal with strict review. |
| /api/observer | GET / POST | Read safe readiness or obtain advisory text evidence. |

This is a same-origin, session-authenticated browser integration, not a public machine-authenticated SaaS API or an MCP server. The Gateway panel makes the integration reviewable without claiming a deployment architecture that has not been implemented.

There is also no cryptographic proof that approval came from a physical human. Production planners and operators should have separate authenticated principals and permissions. Merely omitting execute from a convenience client is not equivalent to isolating the server endpoint from a compromised operator session.

## 12 What the pretrained observer does

The observer classifies text for signs of prompt injection. It is a small pretrained classifier, rather than a chat model generating a security rationale. The app can scan customer context and proposed replies, display a verdict and include the evidence in a staged plan.

~~~diagram
Browser scan or support proposal
                |
App authentication + input bounds + redaction
                |
Authenticated Python inference service
                |
Token windows -> pretrained classifier scores
                |
App validates revision, labels and coverage
                |
Advisory evidence in UI and stored plan
                |
Existing policy and approval rules unchanged
~~~

Inputs are limited to eight texts, 6,000 characters each and 12,000 total, inside a 64 KB JSON envelope. IDs and model keys are validated. Recognizable credentials, email addresses and control characters are handled before forwarding. The service requires a bearer credential, which remains on the server side.

The service tokenizes inputs into windows of 512 tokens including special tokens. Adjacent windows overlap by 64 tokens. Up to 32 segments may be processed. Incomplete coverage cannot produce a benign verdict; it returns unknown. Evidence records token intervals, segment scores, the maximum score, coverage, threshold, model revision, device, precision and latency.

A single inference slot rejects concurrent work rather than accumulating an unbounded queue. The app enforces a maximum 15-second deadline, response-size bounds, strict evidence validation and no redirects. Missing, busy, timed-out or malformed responses become unavailable or unknown evidence. A timeout does not cancel an already running CPU operation.

A benign verdict cannot expand permissions, supply approval or dispatch effects. A suspicious verdict does not automatically reject otherwise permitted business actions. This shadow-mode design allows measurement before changing operator workload. The app supplies its own fixed explanations rather than treating remote service prose as authoritative instructions.

## 13 Model choices and measured observer behavior

PIGuard is the public model that has actually run in this checkout. The registry also supports two Meta Prompt Guard alternatives, but those gated weights have not been verified here. The models are pinned to immutable revisions rather than moving main branches.

| Key | Model | Current evidence |
| --- | --- | --- |
| piguard | leolee99/PIGuard | Public checkpoint; actual local CPU/bfloat16 inference verified. |
| prompt-guard-22m | meta-llama/Llama-Prompt-Guard-2-22M | Smaller comparison candidate; requires accepted terms, access and its own test report. |
| prompt-guard-86m | meta-llama/Llama-Prompt-Guard-2-86M | Multilingual comparison candidate; requires separate verification. |

PIGuard's pinned revision is dd78b24e330193a22d2293ac66922dd4f982f563. Its model card lists MIT licensing [3]. The service reproduces the inspected first-token classifier head locally with trust_remote_code disabled. It verifies the original safetensors checksum, checks tensor names and shapes, and loads bounded chunks into the selected precision. It accepts no executable remote model class or pickle checkpoint.

The latest development evaluation contains six benign and six suspicious inputs. Ten received the expected label. One mixed-language attack was missed; one harmless quoted attack triggered a false alarm. There were no unknown results in those twelve short inputs. On the 11 October rerun, warm sequential app-to-service p50 latency was 1,079 ms and p95 was 1,439 ms on this machine.

A separate 540-token input required two windows. The first recorded run took about 24.97 seconds at the service and correctly timed out at the app's 15-second deadline. On the 11 October rerun it completed in about 13.18 seconds at the service and 13.32 seconds through the app. Host conditions affect latency; short-input measurements do not establish reliable interactive performance for long tickets.

The 0.9 threshold is experimental. Scores are not calibrated probabilities that an action is safe. These twelve authored examples are development fixtures, not a held-out benchmark, vendor comparison or measurement of reduced human-review effort. The observed miss, false alarm and long-input latency justify keeping the classifier advisory while collecting broader evidence.

## 14 Evaluation and why the chosen combination won

The comparison workspace runs five local controls against identical trusted records and proposal batches. It includes 29 cases: 21 attack cases and eight legitimate cases, containing 21 unsafe proposals, 14 legitimate actions and 11 safe actions mixed into attacks.

| Local control | Unsafe authorized / 21 | Legitimate blocked / 14 | Mixed safe retained / 11 | Safe approval actions |
| --- | --- | --- | --- | --- |
| Schema only | 18 | 0 | 11 | 0 |
| Content heuristic | 17 | 5 | 10 | 0 |
| Task standard | 0 | 0 | 11 | 1 |
| Task strict | 0 | 0 | 11 | 25 |
| Heuristic plus task standard | 0 | 5 | 10 | 1 |

The content heuristic is an inspectable three-phrase matcher. It is an illustrative baseline, not PIGuard or an enterprise detector. Schema-only is intentionally unsafe because correct argument shape is not authorization. Neither weak control is an execution mode for the current support application.

Selection first minimizes unsafe authorization, then legitimate blocking, then maximizes useful actions retained in mixed attacks, then minimizes safe approval count. Task-standard wins this declared ordering on these fixtures. Strict remains the external gateway's policy because that trust boundary requires mandatory review.

Approval-required counts as authorized for unsafe proposals. Otherwise a strategy could hide missing authorization by merely asking someone to approve dangerous actions. For safe proposals, approval-required counts as retained utility while its extra review demand is measured separately.

This suite does not call a model or execute connectors. It measures proposal-level decisions with explicit labels. It does not rank OPA versus Cedar, HTTP versus MCP, database products or commercial vendors. Approval count is a workload proxy; it is not measured operator time.

The separate support-policy report covers 20 explicit cases and records zero unsafe authorizations among 15 unsafe proposals and zero blocked legitimate actions among nine legitimate actions. Neither small fixture suite proves general prompt-injection resistance or production accuracy.

## 15 Test evidence, legacy laboratory and privacy

The Gemini integration validation recorded 227 passing Node tests, a passing typecheck, a successful production build and eight passing support HTTP groups. The unchanged observer service previously passed 13 Python tests. Node tests cover authorization, forged receipts, mixed batches, both provider protocols, Gemini thought signatures, malformed responses, credential redaction, transaction faults, concurrency, isolation and recovery. Python tests exercise coverage, scores, concurrency, authentication and checkpoint loading without treating mocks as real inference.

| Evidence artifact | What it demonstrates |
| --- | --- |
| output/support-http-check.json | Eight real HTTP/D1 groups, including atomic execution, approvals, concurrent retries and stale-plan rollback. Test-owned successful executions are recovered. |
| output/observer-http-check.json | Six groups including real pretrained inference, strict validation, preserved approval boundaries and the long-input deadline. |
| output/observer-evaluation.json | Actual pinned-model labels and local latency on twelve authored inputs. |
| output/observer-ui-check.json | Sixteen panel/viewport combinations with recorded overflow measurements. |
| output/support-live-check.json | Latest actual provider-backed planning smoke check, including receipt verification and rejected-plan cleanup. |
| output/gemini-live-normal-check.json | Preserved successful normal-ticket Gemini run; no connector executed. |
| output/gemini-live-injection-check.json | Preserved successful injected-ticket run; no connector executed. |
| output/combination-evaluation.json | Transparent local control comparison, decision reasons and selection criteria. |
| output/local-readiness-check.json | Fresh local route readiness and one actual short pretrained scan; no execution or provider call. |
| output/verification-check.json | Earlier combined check record, including the then-unconfigured OpenAI status; retained as historical evidence. |
| output/gemini-verification-check.json | Subsequent Gemini integration checks, actual planning evidence and limitations. |

The older /lab workspace preserves eight attack scenarios, four difficulty framings, synthetic actors, editable action JSON and unprotected/observe/enforce comparisons. Its mock proposal generator is deterministic; arbitrary edited language is not generally interpreted by an LLM. Custom submitted actions are forced through enforcement, and caller trust claims are downgraded. Weak modes are counterfactual demonstrations, not permission to perform their simulated dangerous effects.

The audit explorer groups synthetic user and prompt history, supports JSON exports and generates structured user or prompt PDF reports. Recent display windows do not imply deletion of all older database records. Its private-site perimeter is not a full production organization-role system.

Support-plan evidence, audit text and outbound observer inputs use best-effort redaction. The observer evidence omits the submitted prose, but support plans can retain separately redacted task context. Unknown confidential formats can remain. Choose a suitable inference destination and retention policy before using real customer data. No externally anchored audit integrity, comprehensive data-loss prevention or production compliance claim is made.

## 16 Local setup and operating the demo

Use the agentshield directory as the project root. Node 24 LTS is recommended for the SQL-backed tests; the package declares a minimum of Node 22.13. Use Python 3.12 for the observer environment. Dependencies and model weights are already present in this checkout, so repeated installation is unnecessary unless they are missing or changed.

For a fresh checkout, install Node dependencies with npm run install:ci and initialize the local database with npm run db:local:init. Create the isolated observer environment and install its pinned requirements as described below.

~~~powershell
python -m venv services/observer/.venv
services/observer/.venv/Scripts/python.exe -m pip install -r services/observer/requirements-torch.txt
services/observer/.venv/Scripts/python.exe -m pip install -r services/observer/requirements-dev.txt
npm run observer:dev
~~~

Start npm run dev in another terminal, then open http://localhost:5173. Keep the observer terminal running for actual scans. The helper configures a random bearer credential in ignored .env.observer.local and .dev.vars files, preserving other entries. It caches model files under services/observer/.models. Restart the app after changing model or service configuration.

| Server setting | Purpose |
| --- | --- |
| PLANNER_PROVIDER | Explicit server-owned gemini or openai selection; never silently falls back. |
| GEMINI_API_KEY / GEMINI_MODEL | Server-only Google credential and optional model; default gemini-3.5-flash-lite. |
| OPENAI_API_KEY / OPENAI_MODEL | Optional OpenAI credential and model; default gpt-5-mini. No browser access. |
| OBSERVER_URL / OBSERVER_TOKEN | Private inference endpoint and service credential. |
| OBSERVER_MODEL | Allowlisted active model key. |
| OBSERVER_TIMEOUT_MS | Bounded app deadline, from 500 to 15,000 ms. |
| OBSERVER_ALLOW_LOCAL | Explicit loopback HTTP permission for local development only. |

Configure server credentials in ignored .dev.vars for the local demo, and separately in hosted environment secrets if publishing. Never paste keys into chat, commit them or place them in client code. Replace any exposed key before public use. A Gemini key selects Gemini when PLANNER_PROVIDER is absent; otherwise the OpenAI default is retained. An explicit provider with a missing key leaves Live unavailable. Replay and the local classifier require neither provider key.

The hosted Worker cannot reach this laptop's localhost service. Hosted inference requires a separate HTTPS service, sufficient memory, injected secrets and measured performance. The Dockerfile is a starting point, not a verified deployment. The chosen scope is a local demo first; no paid hosting is provisioned.

## 17 Reproducing checks and interpreting failures

Run checks from the project root. Keep HTTP and observer checks sequential to avoid intentional single-slot inference refusal being confused with a model failure. On a memory-constrained machine, stop the observer while building or running broad parallel tests.

~~~powershell
npm run typecheck
npm test
npm run build
npm run evaluate:support
npm run evaluate:combinations
$env:SUPPORT_BASE_URL='http://localhost:5173'
npm run check:support
npm run check:observer
npm run evaluate:observer
npm run test:observer
~~~

Use localhost for the local app. This machine's dev server binds IPv6 loopback; 127.0.0.1 may not reach it. The support HTTP checker now defaults to localhost, matching the app's printed URL. The explicit SUPPORT_BASE_URL above also supports a different local port. Observer checks include a long real-inference call and can take substantially longer than one short scan.

Run npm run check:live only after secure provider configuration and an app restart. It stages one actual provider-backed plan, inspects its trace and receipt, then rejects its own plan. It never executes refunds, invoice writes or replies. Missing credentials produce not_run. Quota, authentication and transport errors must be diagnosed rather than counted as successful evaluation.

An unavailable observer can mean the service is stopped, still warming up, busy, unreachable or too slow. The Setup panel exposes safe readiness without secrets. An unloaded Meta model cannot be scanned merely because it appears in the registry. A benign scan requires complete validated coverage; unknown is not a weaker spelling of benign.

The HTTP support checker commits and then compensates its own test plans. History and version increments remain as evidence. Do not reset or delete unrelated records to make a report look clean. A stale-plan conflict is expected concurrency protection, not automatically an application defect.

The build/test cycle should follow actual changes: build the next capability, check its meaningful invariants, fix failures, and proceed. Repeating a previously passing suite without changes or a new concern adds little evidence.

## 18 Worked demonstrations

Start with Maya's normal replay under standard policy. In Inbox select her ticket; in Planner stage the normal scenario. Review the $25 credit, invoice transition and original-recipient reply. Before execution, show that the invoice and outbox have not received those proposed effects. The stored plan is evidence of a proposal, not a financial write.

Execute the plan, then inspect Activity. Show one refund-ledger effect, a queued reply and the committed invoice state. Recover the plan. Show restored supported values, a cancelled reply and both lifecycle events. Explain why the invoice version continues to increase even though the financial amount has been restored.

Next stage the injection scenario. The imported attachment requests an export and redirected reply. Show its untrusted origin, the server-owned grant and the concrete denied arguments. Where the batch also contains legitimate work, show that those actions remain available. This demonstrates useful containment rather than merely blocking all activity associated with suspicious text.

For approval behavior, stage Jordan's $75 credit under standard policy, or stage Maya under strict policy. Demonstrate that approval is required for permitted work. A $999 credit or wrong-recipient reply remains blocked even with approval. Reject any plan you do not intend to execute.

Use the Evaluation Gateway panel to stage an external $25 refund proposal. It should be strict regardless of the comparison workspace's preferred standard strategy. Inspect the same stored preview and receipt; do not describe submission as execution.

In Observer, compare ordinary invoice text, a direct injection and a harmless quotation of suspicious instructions. Inspect score, complete coverage, device, precision and model revision. Use the recorded mixed-language miss and false alarm to explain why the classifier does not replace authorization. Long-input unknown demonstrates an operational limit.

For a live demonstration, choose Live Gemini in the Planner and identify the model in the receipt. Show its scoped invoice read and staged actions, then inspect the policy and execute or reject deliberately. Use the preserved Gemini smoke artifacts as evidence; keep Replay labeled as deterministic. Do not imply the OpenAI adapter has also run against its provider.

## 19 Learning roadmap and source-code navigation

You do not need to train an LLM from scratch to understand this project. Start with application state, runtime validation and the difference between information and authority. Then study database correctness before moving to inference deployment.

| Topic | Why it matters here | Small practice exercise |
| --- | --- | --- |
| JavaScript async, promises and JSON | Requests, tool calls and database operations complete asynchronously. | Fetch a JSON resource, handle a failed response and distinguish timeout from a valid empty result. |
| TypeScript and discriminated unions | Each action type has a different supported shape. | Add an imaginary action type to a union and observe compile-time exhaustiveness checks. |
| Runtime validation with Zod | TypeScript types disappear at runtime; incoming JSON is untrusted. | Submit an unknown authority field and explain why strict validation rejects it. |
| React state, effects and forms | Panels reflect selected tasks and asynchronous server state. | Trace a stage-button click through loading, success and error states. |
| HTTP, authentication, origins and CSRF | Knowing who a caller is differs from checking what they may do. | Compare unauthenticated, wrong-origin and valid local requests. |
| SQL keys, constraints and transactions | Effects must either commit together or leave no partial state. | Force a constraint failure and verify that the queued reply was not committed. |
| Idempotency and optimistic concurrency | Same-plan retries and different stale plans need different behavior. | Contrast five retries of one plan with two plans from one invoice version. |
| Hashes and canonical serialization | Review binds to a concrete stored proposal. | Change one argument and explain why the old receipt no longer matches. |
| Prompt injection and function calling | Untrusted prose can influence proposals but cannot confer authority. | Follow a denied export call and a subsequent permitted reply through the trace. |
| Classification metrics and tokens | False alarms, misses and unscanned text affect interpretation. | Explain why incomplete coverage must be unknown and a score is not a safety guarantee. |
| Python inference and precision | Warmup, checkpoint integrity and memory affect availability. | Compare startup memory with request latency; distinguish BF16 from F32 configuration. |
| Deployment and secret management | Worker, database and model service have different responsibilities. | Draw where each credential lives and why a hosted Worker cannot call laptop localhost. |

Read chapters 5 through 10 alongside lib/support/types.ts, fixtures.ts, policy.ts, agent.ts, live-agent.ts and store.ts. Read the database/support-schema.sql constraints with the store's execution and compensation statements. lib/execution/request.ts and client.ts explain the external proposal envelope.

For the observer, start with lib/observer/types.ts and server.ts, then services/observer/observer_service/app.py, engine.py, loader.py and checkpoint.py. The registry pins model identity; engine code handles segmentation and aggregation; loading code validates the actual checkpoint.

The three main workspace components are components/support-workspace.tsx, combination-workspace.tsx and observer-workspace.tsx. lib/evaluation/combination-evaluation.ts contains comparison semantics. scripts/check-support-http.ts and check-observer-http.ts are useful executable examples of the invariants.

## 20 Limitations, next steps and resume explanation

The implementation is a substantial local prototype, with durable sandbox transactions, real public-model observer inference and verified Gemini planning. Publishing still requires restored access to the existing hosted project, its own provider secrets and a reachable HTTPS observer host. OpenAI real inference is optional and remains unverified. The current preference is a local demo first.

Before autonomous filtering reduces human review, evaluate a larger, separately labeled dataset with multilingual attacks, benign quotations, long documents and domain-specific requests. Measure false blocks, missed attacks, coverage, memory, cold startup, busy responses and operator time. Compare each candidate model with its own pinned revision and precision. Do not tune on twelve development cases and then claim production accuracy.

Before real payments or email, add authenticated production assignments, separate planner and operator roles, provider idempotency keys, an outbox dispatcher, delivery reconciliation and provider-specific compensation. Add retention policies and stronger audit integrity according to deployment requirements. A detector cannot substitute for these system boundaries.

Suggested resume title: **APX - transactional execution and recovery for AI support agents**.

Suggested bullet: "Built an AI support-agent execution layer with customer-scoped authorization, receipt-bound approvals, atomic SQLite/D1 transactions and compensating recovery; verified concurrency, fault rollback and mixed-attack containment with unit, randomized and HTTP integration checks."

An observer bullet can describe a pinned pretrained injection classifier integrated in shadow mode with strict evidence validation and recorded latency, misses and false alarms. A planner bullet can describe provider-independent proposal handling with verified Gemini planning and immutable receipts. Do not claim reduced human intervention, superiority to enterprise alternatives, real payments or a broad live-model security benchmark.

In an interview, walk through one complete Maya execution and recovery. Then explain the stale-plan conflict, the difference between the receipt hash and a signature, why a blocked action cannot be approved, and why an observer outage does not weaken permissions. That gives a reviewer a clear account of what you personally understand and what the system actually does.

Learn SQL transactions, idempotency, prompt injection and authorization particularly well for interviews. Terms to distinguish are proposal versus effect, authentication versus authorization, allow versus approval, rollback versus compensation, classifier verdict versus policy decision, and development fixture versus held-out benchmark.

## 21 Reading references and repository evidence

These primary sources explain background concepts. They are learning resources, not evidence that APX has implemented every capability described by them. The project-specific measurements come from the repository's reports and tests.

1. [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) - model tool requests, application-side handling and tool-result feedback.
2. [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) - batch execution and database operations. Also read [SQLite transactional behavior](https://www.sqlite.org/transactional.html).
3. [PIGuard model card](https://huggingface.co/leolee99/PIGuard) - publisher description, architecture and license information.
4. [React introduction](https://react.dev/learn) - components, state and events.
5. [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html) - types, narrowing and application contracts.
6. [MDN HTTP overview](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview) and [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) - request boundaries and browser behavior.
7. [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) - trusted permission checks and least privilege.
8. [OWASP prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) - untrusted text, tool abuse and layered controls.
9. [PyTorch basics](https://docs.pytorch.org/tutorials/beginner/basics/intro.html) - tensors, models and inference concepts.
10. [Classification metrics](https://scikit-learn.org/stable/modules/model_evaluation.html) - interpreting classification mistakes and choosing suitable metrics.
11. [Meta Prompt Guard 22M](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-22M) and [86M](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M) - candidate model documentation and access terms.
12. [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/) - why model inference needs an appropriate separate host.
13. [Gemini Generate Content API](https://ai.google.dev/api/generate-content), [thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures) and [pricing](https://ai.google.dev/gemini-api/docs/pricing) - native tool declarations, conversation continuity and free-tier limits.

Read the local README.md, SUPPORT_ENGINEERING.md, IMPLEMENTATION_DECISIONS.md, THREAT_MODEL.md, GUARD_MODEL_RESEARCH.md and services/observer/README.md for implementation context. Historical documents may describe earlier states; this guide and the timestamped JSON reports distinguish the current observer work from the deployed site's previous release.

Key report files are output/support-evaluation.json, combination-evaluation.json, support-http-check.json, support-live-check.json, observer-evaluation.json, observer-http-check.json and observer-ui-check.json. Inspect their timestamps, scope, failure fields and limitations before quoting a result. Test counts refer to the recorded complete run, not an unlimited guarantee across future changes.

The editable Markdown version of this guide is docs/APX_PROJECT_GUIDE.md. The accompanying PDF is generated from that source. No credential values, raw customer secrets or model weights belong in either document.


## Interface consolidation and personal model connections (11 October 2026)

The current local interface replaces the earlier separate Permissions and Trace panels: expand Task permissions in Planner and Tool trace and observer evidence in Review. External proposals have moved from Compare → Gateway into Workspace → Connect → Bring an existing agent, and staging opens the existing Review panel. Compare now contains three experiment panels. The support dock contains Inbox, Connect, Planner, Review, and Activity. Attack lab History uses one audit explorer plus a direct full-JSON download.

Connect accepts supported Gemini, OpenAI, Groq, and OpenRouter credentials and model IDs. A synthetic function-call probe verifies the selected model, then an encrypted, owner-bound, HttpOnly cookie holds the personal connection for one hour. Live support planning resolves that connection on the server and continues through the original policy, staging, review, execution, and recovery workflow. Execution of an already-staged plan does not need the provider key. Credentials never expand permissions or remove review requirements. Only scoped sandbox connectors are integrated: API-key entry does not automatically protect other applications, tools, provider-held data, or model weights. See README → Connect your own model and the revised panel quick guide for current usage.
