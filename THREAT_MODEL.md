# APX threat model

## Protected system

APX protects a workplace AI agent that reads documents and tool results, then requests actions from mock email, database, memory, and file tools.

## Attacker

An external sender, low-trust contributor, or compromised internal mailbox that can control an email, uploaded document, or tool-returned text. The attacker cannot modify APX's server-side policy, trusted task definition, or D1 audit tables directly.

## Attacker goals

- Make retrieved text act as privileged instructions.
- Exfiltrate mock secrets to an unauthorized destination.
- Persist a false authorization fact in agent memory.
- cause an unbounded loop and resource-consumption incident.
- Evade known signatures while combining individually allowed tools into a previously unseen harmful sequence.
- Leak data to a recipient inside a broadly approved domain after provenance or sensitivity is mislabelled.

## Trust boundaries

1. User and retrieved content enter as data with an explicit trust label.
2. The model proposes actions but cannot execute tools directly.
3. APX evaluates each action against the trusted task, capability allowlists, data lineage, egress policy, and execution budgets.
4. Only allowed actions reach the mock tool executor.
5. Novel execution fingerprints are held for analyst approval rather than automatically labelled malicious.
6. A server-owned capability passport constrains tenant, tool, operation, filesystem root, database schema, row count, destination, and expiry.
7. Each submitted prompt is redacted and stored before action evaluation; the policy decision is stored before mock tool dispatch, then its outcome is finalized in D1. The model cannot directly write to the policy or audit tables.
8. Custom client submissions are forced into enforce mode, and client claims that retrieved or tool-returned content is trusted are downgraded. Unprotected and observe modes are reserved for exact server-owned demonstration fixtures.

## Out of scope

- Model-weight poisoning and training-time attacks.
- Side channels in real email, operating-system, and cloud integrations.
- Perfect semantic classification of task relevance.
- Guaranteed detection of unknown attacks; Behavior Drift only detects measurable deviation from the configured baseline.
- Tools that execute outside the APX gateway.
- OS-level isolation, symlink-race protection, and an immutable external audit service; the hackathon connectors are in-process simulations.
- Trusted provenance, sensitivity, and task-relevance derivation from a live agent orchestrator. The custom inspector still accepts client-supplied sensitivity and relevance fields; they are not attested. Exact synthetic fixtures are server-controlled.
- Guaranteed removal of every secret from audit records. Redaction is best-effort and unknown formats may survive.
- A guarantee against every obfuscation or unknown secret format.

## Honest security claim

APX reduces impact when an AI agent is manipulated. It does not claim that prompt injection can be perfectly detected or eliminated.
