# APX implementation decisions

APX is an execution control prototype with a working billing-support reference application. The model proposes; trusted application policy authorizes; an operator reviews external proposals; a transaction commits supported effects.

## Decision order

| Decision | Alternatives considered | Current choice and reason |
| --- | --- | --- |
| Identity | Support assistant / execution infrastructure / evaluation platform | Execution infrastructure with support as the reference integration and comparative evaluation as evidence. Reuses a complete workflow while making the boundary reusable. |
| Controls | Schema only / text heuristic / task boundary / strict boundary / heuristic + boundary | Compare all five on identical synthetic proposals. Text heuristics are illustrative, not measurements of vendor defenses. Rank safety, legitimate work, useful mixed-case actions, then review burden. |
| Authority | Application rules / Cedar or OPA / task grants | Typed rules plus expiring grants derived from server-owned ticket records. Adopt a separate policy engine only when independent policy maintenance justifies it. |
| Execution | Immediate calls / staged plans / distributed sagas | Stage immutable reviewed plans; revalidate receipt, ticket and invoice immediately before an atomic D1 batch. External service integrations will require explicit durable compensation and idempotency handling. |
| Integration | Embedded wrapper / HTTP gateway / MCP | HTTP proposal ingress plus a thin client, using existing authenticated session boundaries. No machine authentication or MCP compatibility is claimed. |
| Evidence | Curated demonstration / comparative fixtures / live trials | Comparative fixtures and real SQL/HTTP lifecycle verification now. Live-model trials require a configured provider key and separate repeated-run evaluation. |

These are choices for this prototype's scope, not proof that this architecture is universally better than other products. Security and utility are tested independently. Protocol and storage choices are assessed from requirements; a static action suite cannot experimentally rank those choices.

## Implemented gateway

`POST /api/execution/plans` accepts only:

```json
{
  "ticketId": "tkt-1042",
  "actions": [
    { "id": "refund-1", "type": "refund", "invoiceId": "inv-1042", "amountCents": 2500 }
  ]
}
```

It returns HTTP 201 with `{ "plan": ... }`. The schema limits a batch to eight actions and the streamed body to 12 KB. Identity comes from Sites middleware. Mutations require the application's origin; public cross-origin browser access is not enabled. The owner, grant, profile, approval, receipt, and invoice snapshot cannot be supplied by the planner.

Every external proposal uses **strict** review even if standard policy wins the fixed evaluation on approval burden. This is a deliberate trust distinction: the comparison recommends a default for trusted workflow configuration, whereas the external caller must not choose a weaker profile. Blocked actions cannot be authorized by checking an approval box.

Use `createExecutionClient({ origin: window.location.origin })` from `lib/execution/client.ts` in an authenticated same-origin application. `propose()` stages actions and `getPlan()` reads the result. The client deliberately offers no execute/approve method. Operator review uses the existing workspace and exact receipt. This is an API affordance, not proof that the human physically clicked: server-side credentials and session access must stay outside an autonomous planner's control. A production service integration needs a distinct service principal and separate operator authority.

## Boundary and residual scope

- This implementation has real persisted sandbox effects: invoice state, refund ledger, queued replies, and audit history. It sends no mail and moves no external money.
- Only declared support actions routed through this executor are covered. An agent with independent credentials or direct connector access can bypass this boundary.
- Recovery is compensation based on trusted snapshots and forward-moving versions. It cannot undo delivered email or guarantee reversal of third-party payments.
- Receipts are checksums backed by a trusted database; they are not signatures or an immutable external audit log.
- The action suite measures authorization given supplied proposals. It does not measure model attack susceptibility, live task completion, competitor effectiveness, or production latency.
- A global keyword rejection can suppress legitimate quoted instructions or safe actions in a mixed batch. Detector output should be supplementary evidence unless separately validated for the actual application.

## Reproduce

```sh
npm run evaluate:combinations
npm test
npm run typecheck
npm run build
# With the local app running and its D1 schema initialized:
npm run check:support
```

The comparison workspace at `/evaluation` shows the selection method, per-strategy results, per-case decisions, downloadable evidence, and an actual external proposal staging interface. It keeps comparison modes out of the execution endpoint: weak baselines never dispatch tools.

## Research behind the decisions

- [OpenAI: designing agents to resist prompt injection](https://openai.com/index/designing-agents-to-resist-prompt-injection/) supports constraining the impact of manipulation even when an attack succeeds.
- [AgentDojo results](https://agentdojo.spylab.ai/results/) report utility and attack success separately and warn against unfair comparison of unmatched experiments.
- [Cedar authorization](https://docs.cedarpolicy.com/auth/authorization.html) separates principal/action/resource/context authorization from application behavior.
- [OPA deployment patterns](https://www.openpolicyagent.org/docs/deploy/k8s) distinguish policy decisions from enforcement points.
- [MCP authorization](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/basic/authorization.mdx) requires resource-bound tokens and rejects token passthrough. MCP is deferred until its complete identity boundary can be implemented.
- [Temporal durable execution guide](https://assets.temporal.io/durable-execution.pdf) describes durable workflows and compensating sagas for multi-step external effects.

## Next gates

Before external production connectors: separate planner/operator identities, trusted task provisioning, revocation, per-integration idempotency keys, rate limits, retries and tested compensations. Before security performance claims: unseen cases, independent ground truth review and live repeated trials with documented model/version/cost. Before adopting Cedar/OPA/MCP/Temporal: build an isolated adapter and verify it against the same permission and lifecycle contracts.
