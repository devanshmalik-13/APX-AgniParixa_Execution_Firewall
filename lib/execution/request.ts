import { z } from "zod";
import { supportActionSchema } from "../support/policy";

// Fail closed on unknown authority-bearing fields. External planners cannot set
// owner, profile, grants, lifecycle state, or approval through this envelope.
export const externalProposalSchema = z.object({
  ticketId: z.string().min(1).max(100),
  actions: z.array(supportActionSchema).min(1).max(8),
}).strict();
