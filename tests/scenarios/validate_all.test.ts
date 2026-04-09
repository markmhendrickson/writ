import { describe, it, expect } from "vitest";
import { loadAllScenarios, validateScenario } from "../../src/loader.js";
import type { Scenario, ScenarioCategory } from "../../src/types.js";

const ALL_CATEGORIES: ScenarioCategory[] = [
  "drift",
  "temporal",
  "provenance",
  "constraint",
  "entity",
  "forgetting",
  "update",
  "multi_hop",
  "abstention",
  "work_state",
];

describe("scenario dataset validation", () => {
  let scenarios: Scenario[];

  it("loads all scenarios without parse errors", async () => {
    scenarios = await loadAllScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(40);
  });

  it("every scenario passes structural validation", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    const failures: string[] = [];

    for (const s of scenarios) {
      const errors = validateScenario(s);
      if (errors.length > 0) {
        failures.push(`${s.scenario_id}: ${errors.join("; ")}`);
      }
    }

    expect(failures).toHaveLength(0);
  });

  it("scenario_id matches filename convention (category-NNN-slug)", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    for (const s of scenarios) {
      expect(s.scenario_id).toMatch(/^[a-z_]+-\d{3}-.+$/);
    }
  });

  it("every scenario has a valid category", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    for (const s of scenarios) {
      expect(ALL_CATEGORIES).toContain(s.category);
    }
  });

  it("every scenario has version 1.0.0", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    for (const s of scenarios) {
      expect(s.version).toBe("1.0.0");
    }
  });

  it("every scenario has at least 3 sessions", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    for (const s of scenarios) {
      expect(s.sessions.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("session timestamps are in chronological order", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    for (const s of scenarios) {
      for (let i = 1; i < s.sessions.length; i++) {
        const prev = new Date(s.sessions[i - 1]!.timestamp).getTime();
        const curr = new Date(s.sessions[i]!.timestamp).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    }
  });

  it("probe session exists in sessions array", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    for (const s of scenarios) {
      const ids = s.sessions.map((sess) => sess.session_id);
      expect(ids).toContain(s.probe.session);
    }
  });

  it("ground_truth has current_value and provenance", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    for (const s of scenarios) {
      expect(s.ground_truth.current_value).toBeDefined();
      expect(s.ground_truth.provenance).toBeDefined();
      expect(s.ground_truth.provenance.agent_or_user).toBeTruthy();
    }
  });

  it("abstention scenarios have should_abstain=true", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    const abstention = scenarios.filter((s) => s.category === "abstention");
    for (const s of abstention) {
      expect(s.probe.should_abstain).toBe(true);
    }
  });

  it("constraint scenarios have constraint_application capability", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    const constraint = scenarios.filter((s) => s.category === "constraint");
    for (const s of constraint) {
      expect(s.probe.required_capabilities).toContain("constraint_application");
    }
  });

  it("at least 5 scenarios per original category", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    const counts: Partial<Record<ScenarioCategory, number>> = {};
    for (const s of scenarios) {
      counts[s.category] = (counts[s.category] ?? 0) + 1;
    }

    for (const cat of ALL_CATEGORIES) {
      expect(counts[cat] ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it("memory events have valid types", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    const validTypes = [
      "explicit",
      "mutable",
      "latent",
      "entity",
      "work_state",
      "non_memory",
    ];
    for (const s of scenarios) {
      for (const ev of s.memory_events) {
        expect(validTypes).toContain(ev.type);
      }
    }
  });

  it("no duplicate scenario_ids", async () => {
    scenarios = scenarios ?? (await loadAllScenarios());
    const ids = scenarios.map((s) => s.scenario_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
