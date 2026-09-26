# APX final engineering review — 26 September 2026

This is a hackathon prototype, not a production agent firewall. The working target is a synthetic workplace assistant and in-process tool simulator. A deterministic gateway decides before dispatch; a live LLM is not in the execution path. Scores reflect the repository as tested, including its known miss and false positive.

## Verification evidence

| Check | Result |
| --- | --- |
| Unit/security regressions | 34 passed, 0 failed (`npm test`) |
| TypeScript | Passed (`npx tsc --noEmit --incremental false`) |
| ESLint | Passed (`npm run lint`) |
| Production bundle | Passed (`npm run build`) |
| 16-case adversarial benchmark | 10/11 attacks contained; 1/5 legitimate cases blocked (`npm run evaluate`) |
| Live local HTTP replay | Custom request claiming trusted retrieval and `unprotected` was forced to `enforce`, downgraded to untrusted, blocked before email dispatch, and persisted in D1 with its credential redacted. |
| Live allow and approval paths | Scoped document read executed and finalized in D1. Novel action was held for approval; one analyst approval executed the exact mock action, and a duplicate approval returned HTTP 409. |
| Live benchmark API | 16 cases persisted in D1; 10/11 attacks contained and 1/5 legitimate actions contained, matching the CLI evaluation. |
| Production dependency audit | `npm audit --package-lock-only --omit=dev --audit-level=moderate` found 0 vulnerabilities after refreshing the patched transitive package. |

The measured 90.9% containment and 20% false-positive rates apply only to this fixed, documented case set. The benchmark is deterministic, not a statistical estimate of unseen attacks. Some redaction and database behavior is verified by live replay, but D1 fault injection and concurrency are not automated tests.

## External-review scores (0–10)

| Dimension | Score | Basis |
| --- | ---: | --- |
| Technical sophistication | 7.5 | Policy, connectors, D1 audit, replay, approval, behavior drift |
| AI-security relevance | 9.0 | Tool-boundary controls address agent-specific attack paths |
| Cybersecurity quality | 7.0 | Strong scopes; identity and provenance need production attestation |
| Architecture | 7.5 | Clear policy/connector/store split; UI and persistence can be smaller |
| Performance | 7.0 | Small deterministic evaluation; large client dependency graph |
| Code quality | 7.0 | Typed modules, passing lint; some oversized UI files |
| Maintainability | 7.0 | Explicit fixtures/tests; hardcoded demo task and policy constants |
| Security robustness | 6.5 | A known bypass, best-effort redaction, in-process mock boundary |
| Demonstrability | 9.0 | Side-by-side modes, live inspector, audit drilldown, PDF and benchmark |
| Innovation | 8.0 | Capability passport plus behavior-drift analyst gate |
| Reliability | 7.0 | Fail-closed gateway writes; concurrency/fault paths need more testing |
| Auditability | 8.0 | Pre-dispatch decision, redaction, D1 history, receipt and exports |
| UI/UX | 8.0 | Responsive attack visualization and readable decision evidence |
| Hackathon readiness | 8.0 | Complete local demo and measured limitations; deployment still needs verification |

**Final readiness: 7.5/10 for a judged prototype; not production-ready.**

## Ten remaining weaknesses, in priority order

| # | Severity | Area | Why it matters | Recommended fix |
| --- | --- | --- | --- | --- |
| 1 | High | `app/api/*` | No application-level identity/role check; private Site hosting is the current perimeter. Public deployment could expose audit data and analyst decisions. | Add server-authenticated SSO and RBAC to every API route. |
| 2 | High | `lib/security/policy-engine.ts`, `lib/security/evaluation.ts` | Known internal-recipient encoded-secret bypass in the benchmark. An approved domain is broader than an approved person or workflow. | Bind recipients to task-scoped identities; decode/inspect more encodings, and hold sensitive internal transfers. |
| 3 | High | `lib/security/request-schema.ts`, `lib/security/ingress.ts` | Custom clients still supply sensitivity and relevance. APX cannot verify what was actually retrieved. | Have a trusted orchestrator attach signed provenance and server-derived labels. |
| 4 | High | `lib/security/types.ts`, `lib/security/policy-engine.ts` | Loop count is supplied in the action envelope; omission evades the per-action budget. | Keep server-owned, per-session iteration and cost counters. |
| 5 | Medium | `lib/security/connectors.ts` | Connectors simulate tools in process; they do not prove OS sandbox, network egress, or real database isolation. | Add a narrow real adapter behind the same policy with platform-level isolation. |
| 6 | Medium | `lib/security/run-store.ts` | Receipt chain and sequence are not atomic under concurrent inserts; D1 operator access could alter history. | Serialize sequence assignment and anchor signed hashes outside D1. |
| 7 | Medium | `lib/security/audit-redaction.ts` | Pattern-based masking misses novel or split secrets; logs can still contain private data. | Add structured sensitive-field suppression, retention policy, and stronger secret scanning. |
| 8 | Medium | `app/api/gateway/route.ts`, `app/api/benchmark/route.ts` | No server-side rate limit; a caller can create many logged requests. | Add per-identity quotas and request-size/cost budgets at the edge. |
| 9 | Medium | `tests/`, `lib/security/run-store.ts` | Automated tests cover policies and adapters but not D1 failure, concurrent audit writes, or analyst replay races. | Add integration tests with local D1 and fault injection. |
| 10 | Low | `app/page.tsx`, `components/audit-explorer.tsx` | Large UI modules and client bundle increase review and regression cost. | Split attack controls, result view, and audit explorer into focused components. |

## Ten strongest technical aspects

1. Deterministic authorization sits between an agent proposal and tool execution.
2. Server-owned task grants constrain tool, operation, data, tenant, path, recipient, rows, and expiry.
3. Connectors repeat critical checks, so direct adapter calls cannot trivially bypass policy.
4. Filesystem canonicalization rejects traversal, protected paths, and executable writes.
5. Structured database access rejects raw SQL-style freedom and cross-tenant queries.
6. Egress and credential checks are applied to the actual email recipient, including argument/destination conflicts.
7. Unknown behavior can request scoped, expiring analyst approval instead of automatic trust.
8. Prompt and decision are persisted before dispatch; audit-write failure prevents execution.
9. Stored evidence is redacted, inspectable, exportable, and tied to a SHA-256 decision receipt.
10. The repeatable benchmark reports both a known bypass and a legitimate false positive.
