import assert from "node:assert/strict";
import test from "node:test";
import { redactAuditText, redactAuditValue } from "../lib/security/audit-redaction";
import { scanForSecrets } from "../lib/security/secret-scanner";

test("structured credential fields are redacted even without recognizable token syntax", () => {
  const value = { arguments: { password: "synthetic-passphrase", nested: [{ apiKey: "short-demo-key", authorization: "custom-scheme-value" }] } };
  const safe = JSON.stringify(redactAuditValue(value));
  assert.doesNotMatch(safe, /synthetic-passphrase|short-demo-key|custom-scheme-value/);
  assert.equal(value.arguments.password, "synthetic-passphrase");
});

test("known credentials are removed from prompts and nested action payloads", () => {
  const prompt = "api_key=sk-demo_1234567890abcdef bearer abcdefghijklmnopqrstuvwxyz123456";
  const value = { prompt, action: { arguments: { note: "password: hunter2" } } };
  const redacted = redactAuditValue(value);
  assert.doesNotMatch(JSON.stringify(redacted), /sk-demo_1234567890abcdef|hunter2|abcdefghijklmnopqrstuvwxyz123456/);
  assert.match(redacted.prompt, /\[REDACTED/);
  assert.equal(value.prompt, prompt);
});

test("audit redaction keeps non-secret attack evidence readable", () => {
  assert.equal(redactAuditText("Read /workspace/tickets/ticket-1042.txt"), "Read /workspace/tickets/ticket-1042.txt");
});

test("base64-wrapped credential labels are not retained", () => {
  const token = btoa("api_key=sk-demo_1234567890abcdef");
  assert.equal(redactAuditText(`encoded ${token}`), "encoded [REDACTED ENCODED SECRET]");
});

test("Google legacy and auth API key formats are recognized and redacted", () => {
  for (const key of ["AIza" + "A".repeat(35), "AQ." + "B".repeat(48)]) {
    assert.equal(redactAuditText(`Credential ${key}`), "Credential [REDACTED API KEY]");
    assert.ok(scanForSecrets(`Credential ${key}`).some((match) => match.type === "api_key"));
  }
});
