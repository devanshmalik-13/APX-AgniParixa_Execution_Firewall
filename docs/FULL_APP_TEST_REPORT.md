# Full application test report

Tested locally on 15 November 2026, using Gemini 3.5 Flash-Lite and PIGuard on CPU in bfloat16. The app is at http://localhost:5173 and the observer service listens on loopback port 8091.

## Results

| Check | Result |
| --- | --- |
| Lint and strict TypeScript | Pass; zero warnings |
| TypeScript unit tests | 251 passed; no failures or skips |
| Python observer unit tests | 13 passed |
| Production build | Pass |
| Deterministic policy evaluations | 16 security cases, 20 support cases, five comparison controls across 29 cases |
| Support HTTP/D1 integration | Eight groups passed, including atomic execution, concurrent claims, approval, rollback and recovery |
| Attack Lab HTTP integration | Pass; validation, redaction, recipients, memory boundaries, approval concurrency, audit analysis, JSON export, PDFs and benchmark |
| Observer HTTP integration | Six groups passed using actual pretrained inference |
| Route and model-connection checks | All five app routes loaded; Gemini capability probe, encrypted cookie, tamper rejection and disconnect passed |
| Live Gemini planning | Normal and injected tickets passed; plans verified and rejected without executing connectors |
| Browser workflow | Ticket selection, strict approval, blocked attacks, execution, recovery, activity, Connect, comparison recomputation/search, observer scan/results/setup/method, Attack Lab, benchmark and audit analysis passed |
| GitHub Actions on application commit 8c32ee5 | Both jobs passed |

The browser test staged an injected strict plan, confirmed that execution was disabled until approval, executed only permitted sandbox actions, then recovered them. The exported customer records and redirected reply remained blocked. The browser observer classified the injected sample as suspicious with complete coverage. No browser console error was reported during that observer run.

## Timing issue fixed

The long observer check can exceed the app's 15-second deadline. Cancelling the app request does not cancel CPU inference in the separate Python service. The next evaluation previously ran while that inference was finishing and received busy responses. The checker now waits for a successful short scan, retrying only explicit busy responses for up to 60 seconds. The observer integration and evaluation then passed in sequence. Lint and type checking were rerun after this script-only change.

## Limits and measurements

PIGuard classified all 12 authored development inputs. It missed one suspicious input and produced one false alarm. Warm sequential round trips measured p50 2,282 ms and p95 2,936 ms. These are local development measurements, not general accuracy or production latency claims.

The 540-token, two-window CPU scan took 24,800 ms. The app correctly returned unavailable/unknown at 15,007 ms and retained deterministic permissions. Meta Prompt Guard comparators and live OpenAI, Groq and OpenRouter requests require separate access or credentials and were not run.

All records and effects were synthetic. Successful test executions were recovered and staged live plans were rejected. Audit history and increasing invoice versions remain. App and observer processes were left running.

Machine-readable results are in [full-app-test-report.json](../output/full-app-test-report.json), with individual reports listed there. Local screenshots are `output/full-app-planner-browser.jpg` and `output/full-app-observer-browser.jpg`.
