import { attackLevels, promptForLevel, proposeAction } from "./attack-lab";
import { attackScenarios } from "./scenarios";

// JSON object key order is not part of an action's meaning. Validation may
// reorder keys before returning the same action to the UI.
function canonicalJson(value: unknown): string | undefined {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
    return item;
  }
  return JSON.stringify(ordered(value));
}

/** Only server-defined, unchanged replays may use comparison modes. */
export function isExactDemoFixture(scenarioId: unknown, attackLevel: unknown, prompt: string, action: unknown): boolean {
  const scenario = attackScenarios.find((item) => item.id === scenarioId);
  const level = attackLevels.find((item) => item === attackLevel);
  if (!scenario || !level || prompt !== promptForLevel(scenario.id, level)) return false;
  const proposed = proposeAction(scenario.id, level, prompt);
  return canonicalJson(action) === canonicalJson(proposed)
    || (level === "easy" && canonicalJson(action) === canonicalJson(scenario.action));
}
