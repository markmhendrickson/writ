import { describe, it, expect } from "vitest";
import { validateScenario, loadAllScenarios } from "../../src/loader.js";
import type { Scenario } from "../../src/types.js";

function makeMinimalScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    scenario_id: "test-001",
    version: "1.0.0",
    category: "drift",
    description: "Test",
    sessions: [
      {
        session_id: 1,
        timestamp: "2026-01-01T10:00:00Z",
        messages: [{ role: "user", content: "Hello" }],
      },
      {
        session_id: 2,
        timestamp: "2026-02-01T10:00:00Z",
        messages: [{ role: "user", content: "Probe" }],
      },
    ],
    memory_events: [
      {
        id: "fact-1",
        type: "explicit",
        value: "test",
        introduced_in: 1,
        updated_in: null,
        retracted_in: null,
        should_persist: true,
        previous_values: [],
      },
    ],
    probe: {
      session: 2,
      prompt: "What?",
      required_capabilities: ["retrieval"],
      should_abstain: false,
    },
    ground_truth: {
      current_value: "test",
      value_history: [],
      provenance: {
        source_session: 1,
        source_message_index: 0,
        agent_or_user: "user",
      },
    },
    failure_modes: [],
    ...overrides,
  } as Scenario;
}

describe("validateScenario", () => {
  it("returns no errors for a valid scenario", () => {
    const errors = validateScenario(makeMinimalScenario());
    expect(errors).toHaveLength(0);
  });

  it("detects missing scenario_id", () => {
    const scenario = makeMinimalScenario({ scenario_id: "" });
    const errors = validateScenario(scenario);
    expect(errors).toContain("Missing scenario_id");
  });

  it("detects missing version", () => {
    const scenario = makeMinimalScenario({ version: "" });
    const errors = validateScenario(scenario);
    expect(errors).toContain("Missing version");
  });

  it("detects empty sessions", () => {
    const scenario = makeMinimalScenario({ sessions: [] });
    const errors = validateScenario(scenario);
    expect(errors.some((e) => e.includes("No sessions"))).toBe(true);
  });

  it("detects empty memory_events", () => {
    const scenario = makeMinimalScenario({ memory_events: [] });
    const errors = validateScenario(scenario);
    expect(errors.some((e) => e.includes("No memory events"))).toBe(true);
  });

  it("detects bad introduced_in reference", () => {
    const scenario = makeMinimalScenario({
      memory_events: [
        {
          id: "fact-1",
          type: "explicit",
          value: "test",
          introduced_in: 99,
          updated_in: null,
          retracted_in: null,
          should_persist: true,
          previous_values: [],
        },
      ],
    });
    const errors = validateScenario(scenario);
    expect(errors.some((e) => e.includes("non-existent session 99"))).toBe(
      true
    );
  });

  it("detects bad updated_in reference", () => {
    const scenario = makeMinimalScenario({
      memory_events: [
        {
          id: "fact-1",
          type: "mutable",
          value: "test",
          introduced_in: 1,
          updated_in: 99,
          retracted_in: null,
          should_persist: true,
          previous_values: [],
        },
      ],
    });
    const errors = validateScenario(scenario);
    expect(errors.some((e) => e.includes("updated_in"))).toBe(true);
  });

  it("detects probe referencing non-existent session", () => {
    const scenario = makeMinimalScenario();
    scenario.probe.session = 99;
    const errors = validateScenario(scenario);
    expect(errors.some((e) => e.includes("Probe references"))).toBe(true);
  });
});

describe("loadAllScenarios", () => {
  it("loads all scenarios from the scenarios directory", async () => {
    const scenarios = await loadAllScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(40);
  });

  it("every loaded scenario has required fields", async () => {
    const scenarios = await loadAllScenarios();
    for (const s of scenarios) {
      expect(s.scenario_id).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.sessions.length).toBeGreaterThan(0);
      expect(s.memory_events.length).toBeGreaterThan(0);
      expect(s.probe).toBeTruthy();
      expect(s.ground_truth).toBeTruthy();
    }
  });

  it("every loaded scenario passes validation", async () => {
    const scenarios = await loadAllScenarios();
    for (const s of scenarios) {
      const errors = validateScenario(s);
      expect(errors).toHaveLength(0);
    }
  });
});
