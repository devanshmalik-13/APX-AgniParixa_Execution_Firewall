/** Redact recognizable credentials before any prompt or action reaches D1. */
export function redactAuditText(value: string, knownSecrets: readonly string[] = []): string {
  let text = value;
  for (const secret of knownSecrets) {
    if (!secret) continue;
    text = text.split(secret).join("[REDACTED API KEY]");
    text = text.split(encodeURIComponent(secret)).join("[REDACTED API KEY]");
    try { text = text.split(btoa(secret)).join("[REDACTED ENCODED SECRET]"); } catch { /* Literal matching still handles non-Latin secrets. */ }
  }
  return text
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:(?:sk|api)[-_][a-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{35}|AQ\.[A-Za-z0-9_-]{40,})\b/gi, "[REDACTED API KEY]")
    .replace(/\bbearer\s+[a-z0-9._~+/-]{20,}=*\b/gi, "Bearer [REDACTED]")
    .replace(/\b((?:api[_-]?key|secret|password|access[_-]?token|auth[_-]?token)\s*[:=]\s*)[^\s,;"']+/gi, "$1[REDACTED]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED NUMBER]")
    .replace(/\b[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])/g, (token) => {
      try {
        return /(?:api[_-]?key|secret|password|bearer)/i.test(atob(token)) ? "[REDACTED ENCODED SECRET]" : token;
      } catch {
        return token;
      }
    });
}

export function redactAuditValue<T>(value: T, knownSecrets: readonly string[] = []): T {
  if (typeof value === "string") return redactAuditText(value, knownSecrets) as T;
  if (Array.isArray(value)) return value.map(item => redactAuditValue(item, knownSecrets)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isCredentialField(key) ? "[REDACTED]" : redactAuditValue(item, knownSecrets)])) as T;
  }
  return value;
}
import { isCredentialField } from "./secret-scanner";
