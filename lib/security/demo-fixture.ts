import { attackLevels, promptForLevel, proposeAction } from "./attack-lab";
import { attackScenarios } from "./scenarios";

/** Only server-defined, unchanged replays may use comparison modes. */
export function isExactDemoFixture(scenarioId: unknown, attackLevel: unknown, prompt: string, action: unknown): boolean {
  const scenario = attackScenarios.find((item) => item.id === scenarioId);
  const level = attackLevels.find((item) => item === attackLevel);
  if (!scenario || !level || prompt !== promptForLevel(scenario.id, level)) return false;
  const proposed = proposeAction(scenario.id, level, prompt);
  return JSON.stringify(action) === JSON.stringify(proposed)
    || (level === "easy" && JSON.stringify(action) === JSON.stringify(scenario.action));
}
