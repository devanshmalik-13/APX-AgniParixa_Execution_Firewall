export interface SecretMatch {
  type: "api_key" | "bearer_token" | "private_key" | "credit_card" | "encoded_secret";
  preview: string;
}

const detectors: Array<{ type: SecretMatch["type"]; pattern: RegExp }> = [
  { type: "api_key", pattern: /\b(?:sk|api)[-_][a-z0-9_-]{16,}\b/gi },
  { type: "bearer_token", pattern: /\bbearer\s+[a-z0-9._~+\/-]{20,}=*\b/gi },
  { type: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { type: "credit_card", pattern: /\b(?:\d[ -]*?){13,19}\b/g },
];

function redact(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function possibleBase64Tokens(content: string): string[] {
  return content.match(/\b[A-Za-z0-9+/]{24,}={0,2}\b/g) ?? [];
}

function rot13(value: string): string {
  return value.replace(/[a-z]/gi, (character) => {
    const base = character <= "Z" ? 65 : 97;
    return String.fromCharCode(((character.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function possibleRot13Phrases(content: string): string[] {
  return content.match(/\b(?:[A-Za-z]{3,}\s+){2,}[A-Za-z]{3,}\b/g) ?? [];
}

export function scanForSecrets(content = ""): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of content.matchAll(detector.pattern)) {
      matches.push({ type: detector.type, preview: redact(match[0]) });
    }
  }

  for (const token of possibleBase64Tokens(content)) {
    try {
      const decoded = atob(token);
      if (/(?:api[_-]?key|secret|password|bearer)/i.test(decoded)) {
        matches.push({ type: "encoded_secret", preview: redact(token) });
      }
    } catch {
      // Invalid base64 is not a finding.
    }
  }

  // ROT13 is included because it is a documented evaluation bypass. This is a
  // bounded detector, not a claim that arbitrary semantic encoding is solvable.
  for (const phrase of possibleRot13Phrases(content)) {
    const decoded = rot13(phrase);
    if (/(?:api[_-]?key|secret|password|bearer|private\s+key|blue\s+phrase)/i.test(decoded)) {
      matches.push({ type: "encoded_secret", preview: redact(phrase) });
    }
  }

  return matches;
}
