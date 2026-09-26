import type { ActionRequest, TaskContext } from "./types";

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
