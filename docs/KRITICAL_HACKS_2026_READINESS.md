# Kritical Hacks 2026 readiness

Based on the team's supplied guidelines, received 20 October 2026. The online deadline is listed as 20 October; its exact time is absent. Verify the portal's cutoff and required uploads.

**Project pitch:** APX lets support agents use live-web references while keeping customer permissions, approval and execution outside the language model. TinyFish supplies the public input; APX preserves source evidence and constrains its possible effects.

| Requirement | Implementation / remaining action |
| --- | --- |
| AI/ML or Web3 open innovation | AI support-agent authorization and review |
| Functional TinyFish integration | Fetch feeds live planning, with stored provenance and receipt binding. See TINYFISH_INTEGRATION.md. |
| Working public repository and README | Existing repository is public at https://github.com/devanshmalik-13/APX-AgniParixa_Execution_Firewall . Push the final checked changes before submission; public visibility does not mean local changes are already there. |
| Demo video | Still to record. Show a genuine TinyFish fetch and its use in a plan. The supplied guidelines contain a placeholder for video duration; check the form. |
| Presentation/PPT | Prepare after the demo flow is settled; the current request prioritizes implementation. |
| Public social post with repo link | Still to write and publish from the team's account. No post has been sent. |
| Registration and submission | Team must verify 2–5 members, registration, and final form fields. No submission has been made. |

## Suggested demo

1. Explain the risk: useful public text can also contain instructions an agent must not obey.
2. Select a ticket and fetch a real billing reference with TinyFish. Show source URL, excerpt, retrieval time and hash.
3. Use the connected model in Live/Strict mode. If that provider is unavailable, explicitly choose **reference reply · no LLM** and explain the deterministic draft. Show the resulting actions, TinyFish trace entry and sealed evidence. Do not label the deterministic path as model inference.
4. Demonstrate a controlled injection or external-proposal example. Identify the violated grant. Label this as a controlled attack; do not imply that the real Stripe page contained malicious text.
5. Approve permitted sandbox actions, inspect the outbox/invoice, then recover supported changes.
6. Show Activity/History and distinguish fixture benchmark results from live-provider observations. End with the repo link and limitations.

Before recording: run the tests/build/HTTP checks, confirm current provider quota, start the separate observer service if demonstrating it, sign into the local app, and select an unmodified/recovered ticket. Keep password fields out of the recording. Verify that the code, video and post are accessible to the jury. Do not present the stale hosted URL as the current local build; local inference needs separate HTTPS hosting for a hosted demo.

## Originality and disclosure

The existing APX project predates this submission. The Kritical Hacks extension adds TinyFish retrieval, evidence provenance/receipt binding, the one-use credential workflow and its integration tests to the team's existing project. Explain that history accurately. Codex assisted implementation and verification; the team must understand and be able to explain the architecture. Do not claim universal prompt-injection prevention or protection for every external application just by entering an API key.
