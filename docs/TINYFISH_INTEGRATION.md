# TinyFish in APX

TinyFish Fetch retrieves public billing reference material. APX passes it to the live support planner as **untrusted web content**, evaluates the model's proposed actions outside the model, and seals the reference into the plan receipt. This is an input to the actual support workflow, rather than an isolated sponsor example.

## Walkthrough

1. Run the app and sign in locally. Open `/support?panel=planner` and select a synthetic ticket.
2. Under **Bring live web context into the plan**, select a Stripe reference, enter the TinyFish key in its password field, and click **Fetch reference with TinyFish**.
3. Inspect the retrieved URL, timestamp, excerpt, content hash, and any truncation notice. General Stripe documentation is not Northstar policy or proof of customer entitlement.
4. Connect a function-calling model in **Connect** if needed. Choose **Live** and **Strict**, then stage a plan.
5. Review the proposed changes, the sealed TinyFish reference, and the `tinyfish_fetch` trace entry. The model can use relevant reference facts and cite the source, but cannot use the page to expand its permissions.
6. Approve only permitted sandbox effects or reject the plan. Inspect Activity and demonstrate supported recovery. Replay uses fixed proposals and does not interpret web references.

If a model is unavailable, **Stage a reference reply · no LLM** is an explicit alternative. It quotes the retrieved excerpt and trusted invoice total in a deterministic template. The receipt identifies `tinyfish-reference-draft-v1`; no model is called, no refund or invoice update is proposed, and strict approval is required before queuing the reply. The source remains untrusted and must be reviewed. This is not presented as a successful model inference.

## Implementation

`Planner → /api/tinyfish → TinyFish Fetch → account/ticket evidence record → live model → policy → receipt → review → sandbox connectors`

- `GET /api/tinyfish` returns the approved sources and a boolean indicating server-key configuration. It never returns a key.
- `POST /api/tinyfish` accepts `ticketId`, `sourceId`, and an optional one-use `apiKey`. It requires authentication, same-origin mutation checks, a bounded JSON body, and HTTPS outside loopback.
- `POST /api/tinyfish/plan` accepts a ticket and stored evidence ID, and stages only the reference reply under a server-owned strict profile.
- The adapter calls `https://api.fetch.tinyfish.ai` with `X-API-Key`, one catalogued URL, Markdown format, `ttl: 0`, a fixed extraction purpose, and a per-URL deadline. No customer identity, invoice data, model key, login instructions, or write tools go to TinyFish.
- Only approved original/final URLs are accepted. A 35-second timeout, 512 KB response bound, response-schema checks, and explicit page-error handling stop invalid retrievals. There is no fabricated success or fixture fallback.
- Known keys and recognizable secrets are redacted. Up to 8,000 characters are retained, with truncation disclosed. TinyFish can serve cached content even with `ttl: 0`; APX's timestamp records retrieval, not the page's publication or last-update date.
- `support_web_evidence` stores the redacted text and provenance under an account and ticket. Evidence expires for new staging after 15 minutes. `support_web_reservations` provides a durable 30-second per-account fetch cooldown.
- The browser stages only an evidence ID. The server reloads its own record, verifies owner, ticket, freshness, approved source, and content hash, and includes the reference in clearly delimited untrusted context. Client-supplied URLs, evidence bodies, grants, and approval flags are not accepted.
- The exact reference is included in the plan receipt. Changing it invalidates verification. Old receipts remain compatible. The pretrained observer sees overlapping chunks of long context; input limits or outages produce unknown evidence without weakening permissions.

## Keys and boundaries

The one-use TinyFish field is cleared after completion/failure and on ticket changes. It does not use localStorage or persist the key in D1, plans, or audit events. A server-only `TINYFISH_API_KEY` in ignored `.dev.vars` or hosted settings is an alternative. The model-provider key remains separate.

APX protects actions routed through its scoped sandbox connectors. It does not secure unrelated applications, provider-held data, or every possible model statement. It is not a fact checker. TinyFish Fetch reads public references; this integration does not give TinyFish Agent/Browser access to a real billing account. Refunds and email remain sandbox effects.

## Tests and live evidence

Run `npm test`, `npm run typecheck`, and `npm run build`. Tests cover the request contract, source/redirect restrictions, redaction, bounds, durable isolation/expiry/cooldown, receipt tampering, and the complete controlled-provider path through approval, execution, and recovery. These use controlled provider responses and are not live-provider measurements.

Run `npm run check:tinyfish` with the local app running. Its terminal prompt accepts a key through hidden stdin, never command arguments. It retrieves a real reference, validates the content hash, attempts a strict live model plan, and rejects its own plan without executing effects. Key-free outcomes go to `output/tinyfish-live-check.json`; a live fetch can succeed independently of model quota or timeout failures.

Official sources: [Fetch overview](https://docs.tinyfish.ai/fetch-api/index), [Fetch reference](https://docs.tinyfish.ai/fetch-api/reference), [OpenAPI schema](https://agent.tinyfish.ai/v1/openapi/fetch).
