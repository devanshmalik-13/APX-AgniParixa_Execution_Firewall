# Code quality review

This review covers the Gemini planner update on 15 November 2026. The public repository is [APX](https://github.com/devanshmalik-13/APX-AgniParixa_Execution_Firewall).

The subsequent [full application test report](./FULL_APP_TEST_REPORT.md) covers browser execution/recovery, live Gemini, model connections, actual observer inference, audit exports and the observer checker's timing fix.

## Changes

- Removed public-web retrieval routes, provider adapter, reference drafting, UI controls, credentials, schema setup and dedicated scripts. Planning uses assigned ticket data and optional untrusted customer context.
- Gemini is the default provider. Existing OpenAI-only server configuration and explicit provider choices remain supported. Missing keys and provider failures never trigger a silent fallback.
- The planner selects Live mode when a configured model is available. The Connect panel continues to support personal provider keys.
- Historical evidence-bearing receipts retain their original hash payload for rejection and recovery. They cannot execute new effects; the operator is prompted to stage a fresh plan. Existing database records are preserved.
- Included the checkout's existing audit-workflow fixes, request hardening and pinned GitHub Actions configuration.

## Verification

| Check | Result |
| --- | --- |
| Repository lint and strict TypeScript | Pass |
| TypeScript tests | 251 passed; none failed or skipped |
| Python observer tests | 13 passed |
| Production build | Pass; Vinext reports its existing informational route-classification notice |
| Security policy fixtures | 16 cases; no bypasses |
| Support policy fixtures | 20/20 match ground truth; 0/15 unsafe actions authorized |
| Combination comparison | Five controls evaluated; boundary policy permits 0/21 unsafe actions and blocks 0/14 legitimate actions |
| Support HTTP/D1 integration | Eight groups passed; 11 staged plans; successful test effects recovered |
| Gemini normal-ticket planning | Actual provider request passed; invoice read, receipt verified and staged plan rejected with no connector effects |
| Gemini injected-ticket planning | Actual provider request passed in isolation; receipt verified, plan rejected and connector state unchanged |
| Browser planner check | Live Google Gemini selected; retrieval controls absent |

The regression suite checks that retired evidence remains hash-bound, cannot execute, and still permits idempotent rejection/recovery. The HTTP suite rejects the retired evidence-ID request field.

## Reproduce

Use Node 24, install with `npm ci`, then run `npm run verify` and `npm run test:observer`. Start the authenticated local app before `npm run check:support` and `npm run check:live`. Run these HTTP and live suites sequentially: they share a synthetic visitor, so concurrent connector tests can invalidate the live check's unchanged-state assertions. Live planning also enforces a 75-second per-visitor cooldown.

Local secrets belong in ignored `.dev.vars`; no key is committed. Hosted Gemini configuration is separate. These checks use synthetic records and sandbox connectors; they do not establish general prompt-injection detection rates or protect tools that bypass APX. Observer model evaluation results are historical unless explicitly rerun.

See `output/code-quality-check.json`, `output/support-http-check.json`, `output/support-live-check.json`, `output/support-evaluation.json` and `output/combination-evaluation.json` for machine-readable evidence.
