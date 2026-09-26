import { z } from "zod";

const lineageSchema = z.object({
  sourceId: z.string().min(1).max(160),
  sourceType: z.enum(["user_prompt", "retrieved_document", "tool_result", "memory"]),
  trust: z.enum(["trusted", "user", "untrusted"]),
  sensitivity: z.enum(["public", "internal", "confidential", "secret"]),
});

export const actionRequestSchema = z.object({
  id: z.string().min(1).max(80),
  tool: z.string().min(1).max(80),
  operation: z.string().min(1).max(80),
  arguments: z.record(z.string(), z.unknown()),
  destination: z.string().max(320).optional(),
  content: z.string().max(25_000).optional(),
  requestedBy: z.array(lineageSchema).min(1).max(32),
  taskRelevance: z.number().min(0).max(1),
  changesAuthorization: z.boolean().optional(),
  currentIteration: z.number().int().min(0).max(10_000).optional(),
  behavior: z.object({
    toolSequence: z.array(z.string()).max(32),
    destinationSeenBefore: z.boolean(),
    argumentShapeSeenBefore: z.boolean(),
    sensitiveSourceCount: z.number().int().min(0),
  }).optional(),
});

export const gatewayRequestSchema = z.object({
  mode: z.enum(["unprotected", "observe", "enforce"]).default("enforce"),
  prompt: z.string().min(1).max(10_000),
  scenarioId: z.string().min(1).max(80).optional(),
  action: actionRequestSchema,
});
