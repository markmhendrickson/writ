import { describe, it, expect, vi } from "vitest";
import { evaluateScenario, aggregateScores } from "../../src/evaluator.js";
import type { MemoryAdapter, AdapterCapabilities } from "../../src/adapter.js";
import type {
  Scenario,
  ScenarioResult,
  ProbeResult,
  FactHistory,
  Provenance,
  Session,
  ProbeOptions,
} from "../../src/types.js";

vi.mock("../../src/judge.js", () => ({
  judge: vi.fn().mockResolvedValue({
    correct: true,
    partial_score: 1.0,
    reasoning: "mock judge",
  }),
}));

function makeAdapter(overrides: Partial<MemoryAdapter> = {}): MemoryAdapter {
  return {
    name: "test",
    init: vi.fn().mockResolvedValue(undefined),
    processSession: vi.fn().mockResolvedValue(undefined),
    probe: vi.fn().mockResolvedValue({
      answer: "",
      confidence: null,
      cited_sources: [],
      abstained: true,
    }),
    getHistory: vi.fn().mockResolvedValue(null),
    getStateAsOf: vi.fn().mockResolvedValue(null),
    getProvenance: vi.fn().mockResolvedValue(null),
    getCapabilities: vi.fn().mockReturnValue({
      supports_history: true,
      supports_temporal_replay: true,
      supports_provenance: true,
      supports_abstention: false,
      supports_source_authority: false,
      supports_deduplication: false,
      supports_lifecycle: false,
      supports_pre_delivery_certification: false,
    } satisfies AdapterCapabilities),
    reset: vi.fn().mockResolvedValue(undefined),
    teardown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    scenario_id: "test-001",
    version: "1.0.0",
    category: "drift",
    description: "Test scenario",
    sessions: [
      {
        session_id: 1,
        timestamp: "2026-01-01T10:00:00Z",
        messages: [
          { role: "user", content: "My name is Alice." },
          { role: "assistant", content: "Got it, Alice." },
        ],
      },
      {
        session_id: 2,
        timestamp: "2026-02-01T10:00:00Z",
        messages: [{ role: "user", content: "What is my name?" }],
      },
    ],
    memory_events: [
      {
        id: "name",
        type: "explicit",
        value: "Alice",
        introduced_in: 1,
        updated_in: null,
        retracted_in: null,
        should_persist: true,
        previous_values: [
          { value: "Alice", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
        ],
      },
    ],
    probe: {
      session: 2,
      prompt: "What is my name?",
      required_capabilities: ["retrieval"],
      should_abstain: false,
    },
    ground_truth: {
      current_value: "Alice",
      value_history: [
        { value: "Alice", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
      ],
      provenance: {
        source_session: 1,
        source_message_index: 0,
        agent_or_user: "user",
      },
    },
    failure_modes: ["missing_memory"],
    ...overrides,
  };
}

describe("evaluateScenario", () => {
  it("scores recall_correct = true when answer contains expected value", async () => {
    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "Your name is Alice.",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      } satisfies ProbeResult),
    });

    const result = await evaluateScenario(
      makeScenario(),
      adapter,
      "native_memory"
    );

    expect(result.scores.recall_correct).toBe(true);
    expect(result.scores.recall_score).toBe(1.0);
    expect(result.category).toBe("drift");
  });

  it("scores recall_correct = false when answer does not contain expected", async () => {
    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "Your name is Bob.",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      } satisfies ProbeResult),
    });

    const result = await evaluateScenario(
      makeScenario(),
      adapter,
      "native_memory"
    );

    expect(result.scores.recall_correct).toBe(false);
    expect(result.detected_failures).toContain("missing_memory");
  });

  it("scores recall_correct = false when model abstains", async () => {
    const adapter = makeAdapter();

    const result = await evaluateScenario(
      makeScenario(),
      adapter,
      "native_memory"
    );

    expect(result.scores.recall_correct).toBe(false);
  });

  it("scores abstention_correct = true when model should abstain and does", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "What is my blood type?",
        required_capabilities: ["abstention"],
        should_abstain: true,
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "",
        confidence: null,
        cited_sources: [],
        abstained: true,
      } satisfies ProbeResult),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.abstention_correct).toBe(true);
  });

  it("scores abstention_correct = false when model should abstain but answers", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "What is my blood type?",
        required_capabilities: ["abstention"],
        should_abstain: true,
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "Your blood type is A+",
        confidence: 0.5,
        cited_sources: [],
        abstained: false,
      } satisfies ProbeResult),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.abstention_correct).toBe(false);
    expect(result.detected_failures).toContain("false_confidence");
  });

  it("detects hallucination when answer contains no known values", async () => {
    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "Your name is Zephyr Moonstone.",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      } satisfies ProbeResult),
    });

    const result = await evaluateScenario(
      makeScenario(),
      adapter,
      "native_memory"
    );

    expect(result.scores.hallucination_detected).toBe(true);
    expect(result.detected_failures).toContain("memory_hallucination");
  });

  it("scores update_fidelity when value_history has multiple entries", async () => {
    const scenario = makeScenario({
      memory_events: [
        {
          id: "employer",
          type: "mutable",
          value: "Initech",
          introduced_in: 1,
          updated_in: 2,
          retracted_in: null,
          should_persist: true,
          previous_values: [
            { value: "Acme", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
            { value: "Initech", as_of: "2026-02-01T10:00:00Z", source_session: 2 },
          ],
        },
      ],
      ground_truth: {
        current_value: "Initech",
        value_history: [
          { value: "Acme", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
          { value: "Initech", as_of: "2026-02-01T10:00:00Z", source_session: 2 },
        ],
        provenance: {
          source_session: 2,
          source_message_index: 0,
          agent_or_user: "user",
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "You currently work at Initech.",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      } satisfies ProbeResult),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.update_fidelity).toBe(true);
  });

  it("scores update_fidelity = false when answer contains only stale value", async () => {
    const scenario = makeScenario({
      memory_events: [
        {
          id: "employer",
          type: "mutable",
          value: "Initech",
          introduced_in: 1,
          updated_in: 2,
          retracted_in: null,
          should_persist: true,
          previous_values: [
            { value: "Acme", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
            { value: "Initech", as_of: "2026-02-01T10:00:00Z", source_session: 2 },
          ],
        },
      ],
      ground_truth: {
        current_value: "Initech",
        value_history: [
          { value: "Acme", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
          { value: "Initech", as_of: "2026-02-01T10:00:00Z", source_session: 2 },
        ],
        provenance: {
          source_session: 2,
          source_message_index: 0,
          agent_or_user: "user",
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "You work at Acme.",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      } satisfies ProbeResult),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.update_fidelity).toBe(false);
    expect(result.detected_failures).toContain("stale_memory");
  });

  it("evaluates temporal query against expected past value", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "Where did I live in March 2026?",
        required_capabilities: ["temporal_replay"],
        temporal_query: {
          as_of: "2026-03-15T00:00:00Z",
          expect_current: false,
        },
        should_abstain: false,
      },
      ground_truth: {
        current_value: "Seattle",
        value_history: [
          { value: "Portland", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
          { value: "Seattle", as_of: "2026-06-01T10:00:00Z", source_session: 2 },
        ],
        provenance: {
          source_session: 2,
          source_message_index: 0,
          agent_or_user: "user",
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "Portland",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      } satisfies ProbeResult),
      getStateAsOf: vi.fn().mockResolvedValue("Portland"),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.temporal_correct).toBe(true);
  });

  it("scores temporal_correct = null when adapter lacks capability", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "Where did I live in March 2026?",
        required_capabilities: ["temporal_replay"],
        temporal_query: {
          as_of: "2026-03-15T00:00:00Z",
          expect_current: false,
        },
        should_abstain: false,
      },
    });

    const adapter = makeAdapter({
      getCapabilities: vi.fn().mockReturnValue({
        supports_history: false,
        supports_temporal_replay: false,
        supports_provenance: false,
        supports_abstention: false,
        supports_source_authority: false,
        supports_deduplication: false,
        supports_lifecycle: false,
        supports_pre_delivery_certification: false,
      } satisfies AdapterCapabilities),
      probe: vi.fn().mockResolvedValue({
        answer: "Portland",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      }),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.temporal_correct).toBeNull();
  });

  it("checks provenance against ground truth", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "Where did the budget figure come from?",
        required_capabilities: ["provenance_tracing"],
        should_abstain: false,
      },
      ground_truth: {
        current_value: "$5000",
        value_history: [
          { value: "$5000", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
        ],
        provenance: {
          source_session: 1,
          source_message_index: 0,
          agent_or_user: "user",
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "The budget is $5000",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      }),
      getProvenance: vi.fn().mockResolvedValue({
        fact_id: "name",
        source_session: 1,
        source_message_index: 0,
        agent_or_user: "user",
        chain: [
          {
            timestamp: "2026-01-01T10:00:00Z",
            action: "created",
            session: 1,
            value: "$5000",
          },
        ],
      } satisfies Provenance),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.provenance_complete).toBe(true);
  });

  it("scores provenance_complete = false for wrong source_session", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "Where did the budget figure come from?",
        required_capabilities: ["provenance_tracing"],
        should_abstain: false,
      },
      ground_truth: {
        current_value: "$5000",
        value_history: [
          { value: "$5000", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
        ],
        provenance: {
          source_session: 1,
          source_message_index: 0,
          agent_or_user: "user",
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "The budget is $5000",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      }),
      getProvenance: vi.fn().mockResolvedValue({
        fact_id: "name",
        source_session: 99,
        source_message_index: 5,
        agent_or_user: "user",
        chain: [
          {
            timestamp: "2026-01-01T10:00:00Z",
            action: "created",
            session: 99,
            value: "$5000",
          },
        ],
      } satisfies Provenance),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");

    expect(result.scores.provenance_complete).toBe(false);
    expect(result.detected_failures).toContain("provenance_loss");
  });

  it("evaluates constraint_check must_contain / must_not_contain", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "Suggest a dessert for me",
        required_capabilities: ["constraint_application"],
        should_abstain: false,
      },
      ground_truth: {
        current_value: "dairy-free dessert",
        value_history: [
          {
            value: "dairy-free dessert",
            as_of: "2026-01-01T10:00:00Z",
            source_session: 1,
          },
        ],
        provenance: {
          source_session: 1,
          source_message_index: 0,
          agent_or_user: "user",
        },
        constraint_check: {
          must_contain: ["sorbet"],
          must_not_contain: ["cream", "cheese", "milk"],
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "I recommend mango sorbet",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      }),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");
    expect(result.scores.constraint_respected).toBe(true);
  });

  it("fails constraint when must_not_contain term appears", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "Suggest a dessert for me",
        required_capabilities: ["constraint_application"],
        should_abstain: false,
      },
      ground_truth: {
        current_value: "dairy-free dessert",
        value_history: [
          {
            value: "dairy-free dessert",
            as_of: "2026-01-01T10:00:00Z",
            source_session: 1,
          },
        ],
        provenance: {
          source_session: 1,
          source_message_index: 0,
          agent_or_user: "user",
        },
        constraint_check: {
          must_not_contain: ["cream", "cheese", "milk"],
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "Try ice cream with chocolate",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      }),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");
    expect(result.scores.constraint_respected).toBe(false);
    expect(result.detected_failures).toContain("constraint_violation");
  });

  it("does not process sessions in no_memory mode", async () => {
    const adapter = makeAdapter();

    await evaluateScenario(makeScenario(), adapter, "no_memory");

    expect(adapter.processSession).not.toHaveBeenCalled();
  });

  it("attributes failure to state layer for provenance loss", async () => {
    const scenario = makeScenario({
      probe: {
        session: 2,
        prompt: "test",
        required_capabilities: ["provenance_tracing"],
        should_abstain: false,
      },
      ground_truth: {
        current_value: "test",
        value_history: [
          { value: "test", as_of: "2026-01-01T10:00:00Z", source_session: 1 },
        ],
        provenance: {
          source_session: 1,
          source_message_index: 0,
          agent_or_user: "user",
        },
      },
    });

    const adapter = makeAdapter({
      probe: vi.fn().mockResolvedValue({
        answer: "test",
        confidence: 0.9,
        cited_sources: [],
        abstained: false,
      }),
      getProvenance: vi.fn().mockResolvedValue(null),
    });

    const result = await evaluateScenario(scenario, adapter, "native_memory");
    expect(result.failure_attribution).toBe("state");
  });
});

describe("aggregateScores", () => {
  it("returns zeros for empty results", () => {
    const agg = aggregateScores([]);
    expect(agg.scenarios_evaluated).toBe(0);
    expect(agg.recall_accuracy).toBe(0);
  });

  it("calculates correct percentages", () => {
    const results: ScenarioResult[] = [
      {
        scenario_id: "a",
        category: "drift",
        mode: "native_memory",
        probe_result: {
          answer: "x",
          confidence: 0.9,
          cited_sources: [],
          abstained: false,
        },
        scores: {
          recall_correct: true,
          recall_score: 1.0,
          update_fidelity: true,
          drift_detected: true,
          temporal_correct: null,
          provenance_complete: null,
          constraint_respected: null,
          abstention_correct: true,
          hallucination_detected: false,
          source_authority_intact: null,
          dedup_correct: null,
          failure_resilient: null,
          lifecycle_current_correct: null,
          lifecycle_temporal_correct: null,
          pre_delivery_flagged: null,
        },
        failure_attribution: null,
        detected_failures: [],
      },
      {
        scenario_id: "b",
        category: "drift",
        mode: "native_memory",
        probe_result: {
          answer: "y",
          confidence: 0.9,
          cited_sources: [],
          abstained: false,
        },
        scores: {
          recall_correct: false,
          recall_score: 0.0,
          update_fidelity: false,
          drift_detected: false,
          temporal_correct: null,
          provenance_complete: null,
          constraint_respected: null,
          abstention_correct: true,
          hallucination_detected: true,
          source_authority_intact: null,
          dedup_correct: null,
          failure_resilient: null,
          lifecycle_current_correct: null,
          lifecycle_temporal_correct: null,
          pre_delivery_flagged: null,
        },
        failure_attribution: "retrieval",
        detected_failures: ["missing_memory"],
      },
    ];

    const agg = aggregateScores(results);
    expect(agg.scenarios_evaluated).toBe(2);
    expect(agg.recall_accuracy).toBe(0.5);
    expect(agg.update_fidelity).toBe(0.5);
    expect(agg.hallucination_rate).toBe(0.5);
    expect(agg.abstention_quality).toBe(1.0);
  });
});
