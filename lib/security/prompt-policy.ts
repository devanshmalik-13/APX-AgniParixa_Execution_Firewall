// A bounded rule for explicit credential disclosure, not a general-purpose
// language classifier. Tool capability checks remain the primary boundary.
const credential = String.raw`(?:api[\s_-]*keys?|private[\s_-]*keys?|access[\s_-]*tokens?|auth(?:entication)?[\s_-]*tokens?|bearer[\s_-]*tokens?|passwords?|credentials?|secrets?|\.env(?:\.[\w-]+)?(?:\s+file)?)`;
const qualifiers = String.raw`(?:(?:me|us|the|a|an|your|our|my|its|their|this|that|actual|real|current|production|admin|administrator|server|system|application|app|environment|stored|saved|raw|full|complete|decrypted|encoded|openai|anthropic|stripe|of|for|value|contents?)\s+){0,12}`;
const disclosure = new RegExp(String.raw`\b(?:give|show|reveal|disclose|print|display|output|return|retrieve|fetch|read|dump|expose|extract|share|send|email|provide|tell)\s+${qualifiers}${credential}(?![\w-])`, "i");
const valueQuestion = new RegExp(String.raw`\bwhat(?:\s+(?:is|are)|'s)\s+(?:(?:the|your|our|my|its|their|current|production|admin|server|system|stored|actual|real)\s+){1,8}${credential}(?![\w-])`, "i");

export function requestsCredentialDisclosure(prompt = ""): boolean {
  const normalized = prompt
    .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (entity, hex: string | undefined, decimal: string | undefined) => {
      const code = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/&nbsp;/gi, " ")
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
  return disclosure.test(normalized) || valueQuestion.test(normalized);
}
