# AgentShield threat model

## Protected system

AgentShield protects a workplace AI agent that reads documents and tool results, then requests actions from mock email, database, memory, and file tools.

## Attacker

An external sender or low-trust contributor who can control an email, uploaded document, or tool-returned text. The attacker cannot modify AgentShield's server-side policy, trusted task definition, or append-only audit record.

## Attacker goals

- Make retrieved text act as privileged instructions.
- Exfiltrate mock secrets to an unauthorized destination.
- Persist a false authorization fact in agent memory.
- cause an unbounded loop and resource-consumption incident.

## Trust boundaries

1. User and retrieved content enter as data with an explicit trust label.
2. The model proposes actions but cannot execute tools directly.
3. AgentShield evaluates each action against the trusted task, capability allowlists, data lineage, egress policy, and execution budgets.
4. Only allowed actions reach the mock tool executor.

## Out of scope

- Model-weight poisoning and training-time attacks.
- Side channels in real email, operating-system, and cloud integrations.
- Perfect semantic classification of task relevance.
- Tools that execute outside the AgentShield gateway.
- A guarantee against every obfuscation or unknown secret format.

## Honest security claim

AgentShield reduces impact when an AI agent is manipulated. It does not claim that prompt injection can be perfectly detected or eliminated.
