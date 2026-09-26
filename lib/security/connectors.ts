import path from "node:path";
import { canonicalWorkspacePath, emailBoundary, emailRecipient, filesystemBoundary, operationBoundary } from "./boundaries";
import type { ActionRequest, TaskContext, ToolExecutionResult } from "./types";

const workspaceFiles: Record<string, string> = {
  "/workspace/tickets/ticket-1042.txt": "Customer reports a duplicated invoice.",
  "/workspace/policies/refunds.md": "Refunds above $500 require finance approval.",
  "/workspace/drafts/response.txt": "",
};

const customerRows = [
  { id: "cus_42", tenant_id: "velloe-demo", name: "Avery Chen", plan: "Scale", billing_status: "review" },
  { id: "cus_77", tenant_id: "other-tenant", name: "Morgan Lee", plan: "Enterprise", billing_status: "current" },
];
const mockOutbox: Array<{ id: string; recipient: string; content: string }> = [];
const mockMemory: Array<{ id: string; fact: string }> = [];

function canonicalize(candidate: unknown): string {
  return canonicalWorkspacePath(candidate);
}

export function executeFilesystem(task: TaskContext, action: ActionRequest): ToolExecutionResult {
  const scope = task.filesystem;
  if (!scope) throw new Error("Task has no filesystem capability.");
  const violation = filesystemBoundary(task, action);
  if (violation) throw new Error(violation);
  const requestedPath = canonicalize(action.arguments.path);
  const root = path.posix.resolve(scope.root);
  const insideRoot = requestedPath === root || requestedPath.startsWith(`${root}/`);
  if (!insideRoot) throw new Error("Sandbox escape rejected after canonical path resolution.");
  if (!scope.operations.includes(action.operation as "read" | "list" | "write")) {
    throw new Error("Filesystem operation is outside the capability passport.");
  }

  if (action.operation === "list") {
    return { executed: true, tool: action.tool, operation: action.operation, output: Object.keys(workspaceFiles).filter((item) => item.startsWith(requestedPath)) };
  }
  if (action.operation === "read") {
    const value = workspaceFiles[requestedPath];
    if (value === undefined) throw new Error("File is absent from the isolated demo workspace.");
    return { executed: true, tool: action.tool, operation: action.operation, output: { path: requestedPath, content: value } };
  }
  workspaceFiles[requestedPath] = String(action.arguments.content ?? "");
  return { executed: true, tool: action.tool, operation: action.operation, output: { path: requestedPath, bytesWritten: workspaceFiles[requestedPath].length } };
}

export function executeDatabase(task: TaskContext, action: ActionRequest): ToolExecutionResult {
  const scope = task.database;
  if (!scope) throw new Error("Task has no database capability.");
  const table = String(action.arguments.table ?? "");
  const columns = Array.isArray(action.arguments.columns) ? action.arguments.columns.map(String) : [];
  const tenantId = String(action.arguments.tenantId ?? "");
  const limit = Number(action.arguments.limit ?? scope.maxRows);

  if (!scope.operations.includes(action.operation as "select" | "insert" | "update")) throw new Error("Database operation is outside the capability passport.");
  if (!Object.hasOwn(scope.tables, table)) throw new Error("Table is not in the task allowlist.");
  if (columns.length === 0 || columns.some((column) => !scope.tables[table].includes(column))) throw new Error("One or more columns are outside the task allowlist.");
  if (!task.tenantId || tenantId !== task.tenantId) throw new Error("Cross-tenant query rejected.");
  if (!Number.isInteger(limit) || limit < 1 || limit > scope.maxRows) throw new Error(`Row limit must be between 1 and ${scope.maxRows}.`);
  if (action.operation !== "select") throw new Error("Demo connector is read-only even when a task requests a write.");

  const output = customerRows
    .filter((row) => row.tenant_id === tenantId)
    .slice(0, limit)
    .map((row) => Object.fromEntries(columns.map((column) => [column, row[column as keyof typeof row]])));
  return { executed: true, tool: action.tool, operation: action.operation, output: { rows: output, rowCount: output.length, parameterized: true } };
}

export function executeTool(task: TaskContext, action: ActionRequest): ToolExecutionResult {
  const operationViolation = operationBoundary(action);
  if (operationViolation) throw new Error(operationViolation);
  if (!task.allowedTools.includes(action.tool)) throw new Error("Tool is outside the task capability grant.");
  if (action.tool === "filesystem") return executeFilesystem(task, action);
  if (action.tool === "database") return executeDatabase(task, action);
  if (action.tool === "send_email") {
    const violation = emailBoundary(action);
    if (violation) throw new Error(violation);
    const recipient = emailRecipient(action)!;
    const id = crypto.randomUUID();
    if (action.operation === "draft") {
      return { executed: true, tool: action.tool, operation: action.operation, output: { simulated: true, mockDraftId: id, recipient, sent: false } };
    }
    mockOutbox.push({ id, recipient, content: action.content ?? "" });
    return { executed: true, tool: action.tool, operation: action.operation, output: { simulated: true, mockOutboxId: id, recipient, sent: true, outboxCountInThisWorker: mockOutbox.length } };
  }
  if (action.tool === "write_memory") {
    if (action.requestedBy.some((source) => source.trust === "untrusted")) throw new Error("Untrusted content cannot write memory.");
    const id = crypto.randomUUID();
    const fact = String(action.arguments.fact ?? action.content ?? "");
    mockMemory.push({ id, fact });
    return { executed: true, tool: action.tool, operation: action.operation, output: { simulated: true, mockMemoryId: id, fact, memoryCountInThisWorker: mockMemory.length } };
  }
  if (action.tool === "read_document") {
    const documentId = String(action.arguments.documentId ?? "");
    if (!task.allowedData.includes(documentId)) throw new Error("Document is outside the task data grant.");
    return { executed: true, tool: action.tool, operation: action.operation, output: { simulated: true, documentId, content: "Synthetic billing record for the demo task." } };
  }
  throw new Error("No connector is registered for the requested tool.");
}
