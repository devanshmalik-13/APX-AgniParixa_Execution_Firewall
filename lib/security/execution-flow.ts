import type { Decision } from "./types";

export type FlowLight = "reached" | "stopped" | "waiting" | "idle";
export type FlowPhase = "preview" | "running" | "recorded";

/** The gateway runs before the tool. A green proposal never implies tool access. */
export function executionFlow({ decision, phase, executed, analystDecision = "pending" }: {
  decision: Decision;
  phase: FlowPhase;
  executed?: boolean;
  analystDecision?: "pending" | "contained" | "safe" | "failed";
}): { lights: [FlowLight, FlowLight, FlowLight, FlowLight]; endpoint: 2 | 3; caption: string } {
  if (phase === "running") return { lights: ["reached", "reached", "waiting", "idle"], endpoint: 2, caption: "Waiting for the gateway. No tool result yet." };
  if (decision === "block" || analystDecision === "contained") return {
    lights: ["reached", "reached", "stopped", "idle"], endpoint: 2,
    caption: phase === "preview" ? "Projected stop at the gateway. The tool would not be reached." : "Stopped at the gateway. The tool was not reached.",
  };
  if (decision === "approval_required" && analystDecision === "pending") return {
    lights: ["reached", "reached", "waiting", "idle"], endpoint: 2,
    caption: phase === "preview" ? "Projected approval hold. Run the attack to record it." : "Held for analyst approval. The tool was not reached.",
  };
  if (phase === "recorded" && executed !== true) return {
    lights: ["reached", "reached", "reached", "stopped"], endpoint: 3,
    caption: "Passed the gateway, but the connector refused execution.",
  };
  return {
    lights: ["reached", "reached", "reached", "reached"], endpoint: 3,
    caption: phase === "preview" ? "Projected route to the tool. No execution has happened yet." : "Reached the sandbox tool boundary. Check Evidence for the recorded result.",
  };
}
