import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Scenario, ScenarioCategory } from "./types.js";

const SCENARIOS_DIR = join(import.meta.dirname ?? ".", "..", "scenarios");

export async function loadScenario(path: string): Promise<Scenario> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Scenario;
}

export async function loadAllScenarios(
  dir = SCENARIOS_DIR
): Promise<Scenario[]> {
  const files = await readdir(dir);
  const jsonFiles = files
    .filter((f) => extname(f) === ".json")
    .sort();

  const scenarios: Scenario[] = [];
  for (const file of jsonFiles) {
    scenarios.push(await loadScenario(join(dir, file)));
  }
  return scenarios;
}

export async function loadScenariosByCategory(
  category: ScenarioCategory,
  dir = SCENARIOS_DIR
): Promise<Scenario[]> {
  const all = await loadAllScenarios(dir);
  return all.filter((s) => s.category === category);
}

export function validateScenario(scenario: Scenario): string[] {
  const errors: string[] = [];

  if (!scenario.scenario_id) errors.push("Missing scenario_id");
  if (!scenario.version) errors.push("Missing version");
  if (!scenario.category) errors.push("Missing category");
  if (!scenario.sessions?.length) errors.push("No sessions defined");
  if (!scenario.memory_events?.length) errors.push("No memory events defined");
  if (!scenario.probe) errors.push("No probe defined");
  if (!scenario.ground_truth) errors.push("No ground truth defined");

  for (const event of scenario.memory_events ?? []) {
    if (!event.id) errors.push(`Memory event missing id`);
    if (!event.type) errors.push(`Memory event ${event.id} missing type`);

    const sessionIds = scenario.sessions.map((s) => s.session_id);
    if (!sessionIds.includes(event.introduced_in)) {
      errors.push(
        `Memory event ${event.id} introduced_in references non-existent session ${event.introduced_in}`
      );
    }
    if (event.updated_in !== null && !sessionIds.includes(event.updated_in)) {
      errors.push(
        `Memory event ${event.id} updated_in references non-existent session ${event.updated_in}`
      );
    }
  }

  if (scenario.probe) {
    const sessionIds = scenario.sessions.map((s) => s.session_id);
    if (!sessionIds.includes(scenario.probe.session)) {
      errors.push(
        `Probe references non-existent session ${scenario.probe.session}`
      );
    }
  }

  return errors;
}
