import type { ActionRequest, EnforcementMode } from "./types";

/**
 * The public inspector is a demo input, not an attested agent orchestrator.
 * Never let it assign privileged provenance or disable enforcement for an
 * arbitrary action. Exact server-owned fixtures may still demonstrate modes.
 */
export function constrainDemoIngress(action: ActionRequest, mode: EnforcementMode, exactFixture: boolean): { action: ActionRequest; mode: EnforcementMode } {
  if (exactFixture) return { action, mode };
  return {
    mode: "enforce",
    action: {
      ...action,
      requestedBy: action.requestedBy.map((source) => ({
        ...source,
        trust: source.sourceType === "user_prompt" ? "user" : "untrusted",
      })),
    },
  };
}
