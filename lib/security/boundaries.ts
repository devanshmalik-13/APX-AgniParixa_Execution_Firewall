import type { ActionRequest, TaskContext } from "./types";
import { scanActionForSecrets } from "./secret-scanner";

export function credentialBoundary(action: ActionRequest): string | null {
  if (scanActionForSecrets(action).some((match) => match.type !== "credit_card")
    || (action.tool !== "read_document" && action.requestedBy.some((source) => source.sensitivity === "secret"))) {
    return "This task does not grant tools permission to receive or disclose credentials, even at an approved destination.";
  }
  return null;
}

export function memoryBoundary(action: ActionRequest): string | null {
  if (action.tool !== "write_memory") return null;
  if (action.requestedBy.some((source) => source.trust === "untrusted")) return "Untrusted content cannot write memory.";
  const fact = `${action.content ?? ""} ${String(action.arguments.fact ?? "")}`;
  if (action.changesAuthorization || /\b(?:approved|trusted)\s+(?:administrator|admin|recipient|user)\b|\b(?:grant|bypass|disable|override)\b.{0,60}\b(?:access|permissions?|authorization|security|policy)\b/i.test(fact)) {
    return "Preference memory cannot change authorization or grant privileges.";
  }
  return null;
}

export function destinationAllowed(task: TaskContext, action: ActionRequest): boolean {
  const destination = action.tool === "send_email" ? emailRecipient(action) : action.destination;
  if (!destination) return true;
  if (task.allowedDestinations.some((entry) => destination === entry || destination.endsWith(`@${entry}`))) return true;
  return action.tool === "send_email" && Boolean(task.recipientGrants?.some((grant) =>
    destination === grant.recipient && grant.operations.includes(action.operation)
    && action.requestedBy.length > 0
    && action.requestedBy.every((source) => grant.sourceIds.includes(source.sourceId) && source.sensitivity !== "secret")));
}

/** Paths belong to the virtual POSIX workspace, never the host filesystem. */
export function canonicalWorkspacePath(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("A file path is required.");
  const decoded = decodeURIComponent(value).replaceAll("\\", "/");
  if (decoded.includes("\0") || !decoded.startsWith("/")) throw new Error("An absolute path without null bytes is required.");
  const parts: string[] = [];
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function filesystemBoundary(task: TaskContext, action: ActionRequest): string | null {
  try {
    const scope = task.filesystem;
    if (!scope) return "Task has no filesystem capability.";
    const target = canonicalWorkspacePath(action.arguments.path);
    const root = canonicalWorkspacePath(scope.root);
    if (target !== root && !target.startsWith(`${root}/`)) return "Sandbox escape rejected after canonical path resolution.";
    if (!scope.operations.some((operation) => operation === action.operation)) return "Filesystem operation is outside the capability passport.";
    const protectedSegment = target.split("/").some((part) => /^(?:\.env(?:\..*)?|\.ssh|credentials?(?:\..*)?|private[_-]?key(?:\..*)?|audit(?:\..*)?)$/i.test(part));
    if (protectedSegment) return "Protected security file cannot be accessed.";
    if (action.operation === "write" && !target.startsWith(`${root}/drafts/`)) return "Writes are confined to the drafts directory.";
    if (action.operation === "write" && /\.(?:exe|dll|sh|bat|cmd|ps1|js|mjs|py)$/i.test(target)) return "Executable files cannot be created in the workspace.";
    return null;
  } catch {
    return "Invalid filesystem path or encoding.";
  }
}

/** Both the policy and adapter must use the same effective recipient. */
export function emailRecipient(action: ActionRequest): string | undefined {
  const recipient = action.destination ?? action.arguments.recipient;
  return typeof recipient === "string" ? recipient : undefined;
}

export function emailBoundary(action: ActionRequest): string | null {
  const recipient = emailRecipient(action);
  if (!recipient || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) return "A single valid email recipient is required.";
  if (action.destination && action.arguments.recipient !== undefined && action.destination !== action.arguments.recipient) return "Destination and recipient disagree.";
  return null;
}

const connectorOperations: Record<string, readonly string[]> = {
  filesystem: ["read", "list", "write"],
  database: ["select"],
  send_email: ["draft", "send", "send_digest"],
  write_memory: ["save_preference"],
  read_document: ["read", "fetch_again"],
};

export function operationBoundary(action: ActionRequest): string | null {
  const operations = Object.hasOwn(connectorOperations, action.tool) ? connectorOperations[action.tool] : undefined;
  if (!operations) return `No connector is registered for ${action.tool}.`;
  if (!operations.includes(action.operation)) return `${action.operation} is not a permitted ${action.tool} operation.`;
  return null;
}
