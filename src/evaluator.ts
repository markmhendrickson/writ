import type { MemoryAdapter } from "./adapter.js";
import type {
  Scenario,
  ScenarioResult,
  ScenarioScores,
  EvaluationMode,
  FailureMode,
  AttributionLayer,
  AggregateScores,
  ProbeResult,
} from "./types.js";

export async function evaluateScenario(
  scenario: Scenario,
  adapter: MemoryAdapter,
  mode: EvaluationMode
): Promise<ScenarioResult> {
  if (mode !== "no_memory") {
    for (const session of scenario.sessions) {
      if (session.session_id < scenario.probe.session) {
        await adapter.processSession(session);
      }
    }
  }

  const probeResult = await adapter.probe(scenario.probe.prompt, {
    mode,
    oracle_state:
      mode === "oracle_memory"
        ? buildOracleState(scenario)
        : undefined,
  });

  const scores = await scoreResult(scenario, adapter, probeResult);
  const detectedFailures = detectFailures(scenario, scores, probeResult);
  const attribution = attributeFailure(scores, mode);

  return {
    scenario_id: scenario.scenario_id,
    mode,
    probe_result: probeResult,
    scores,
    failure_attribution: attribution,
    detected_failures: detectedFailures,
  };
}

async function scoreResult(
  scenario: Scenario,
  adapter: MemoryAdapter,
  result: ProbeResult
): Promise<ScenarioScores> {
  const gt = scenario.ground_truth;

  const recall_correct = checkRecall(result, gt.current_value);

  let update_fidelity: boolean | null = null;
  if (gt.value_history.length > 1) {
    update_fidelity = checkUpdateFidelity(result, gt.current_value);
  }

  let drift_detected: boolean | null = null;
  const primaryEvent = scenario.memory_events.find(
    (e) => e.type === "mutable"
  );
  if (primaryEvent) {
    const history = await adapter.getHistory(primaryEvent.id);
    drift_detected = history !== null && history.values.length > 1;
  }

  let temporal_correct: boolean | null = null;
  if (scenario.probe.temporal_query?.as_of) {
    const asOfValue = await adapter.getStateAsOf(
      scenario.memory_events[0]!.id,
      scenario.probe.temporal_query.as_of
    );
    temporal_correct = asOfValue !== null;
  }

  let provenance_complete: boolean | null = null;
  if (
    scenario.probe.required_capabilities.includes("provenance_tracing")
  ) {
    const prov = await adapter.getProvenance(scenario.memory_events[0]!.id);
    provenance_complete = prov !== null && prov.chain.length > 0;
  }

  let constraint_respected: boolean | null = null;
  if (
    scenario.probe.required_capabilities.includes("constraint_application")
  ) {
    constraint_respected = !result.abstained && recall_correct;
  }

  let abstention_correct: boolean | null = null;
  if (scenario.probe.should_abstain) {
    abstention_correct = result.abstained;
  } else {
    abstention_correct = !result.abstained;
  }

  const hallucination_detected = checkHallucination(
    result,
    scenario
  );

  return {
    recall_correct,
    update_fidelity,
    drift_detected,
    temporal_correct,
    provenance_complete,
    constraint_respected,
    abstention_correct,
    hallucination_detected,
  };
}

function checkRecall(result: ProbeResult, expected: unknown): boolean {
  if (result.abstained) return false;
  const answer = result.answer.toLowerCase();
  const expectedStr = String(expected).toLowerCase();
  return answer.includes(expectedStr);
}

function checkUpdateFidelity(
  result: ProbeResult,
  currentValue: unknown
): boolean {
  if (result.abstained) return false;
  const answer = result.answer.toLowerCase();
  return answer.includes(String(currentValue).toLowerCase());
}

function checkHallucination(
  result: ProbeResult,
  scenario: Scenario
): boolean {
  if (result.abstained) return false;

  const allValues = new Set<string>();
  allValues.add(String(scenario.ground_truth.current_value).toLowerCase());
  for (const entry of scenario.ground_truth.value_history) {
    allValues.add(String(entry.value).toLowerCase());
  }

  const answer = result.answer.toLowerCase();
  const containsKnownValue = [...allValues].some((v) => answer.includes(v));

  return !containsKnownValue && answer.length > 0;
}

function detectFailures(
  scenario: Scenario,
  scores: ScenarioScores,
  result: ProbeResult
): FailureMode[] {
  const failures: FailureMode[] = [];

  if (!scores.recall_correct && !result.abstained) {
    failures.push("missing_memory");
  }

  if (scores.update_fidelity === false) {
    failures.push("stale_memory");
  }

  if (scores.drift_detected === false) {
    failures.push("silent_drift");
  }

  if (scores.temporal_correct === false) {
    failures.push("stale_memory");
  }

  if (scores.provenance_complete === false) {
    failures.push("provenance_loss");
  }

  if (scores.constraint_respected === false) {
    failures.push("constraint_violation");
  }

  if (scores.hallucination_detected) {
    failures.push("memory_hallucination");
  }

  if (scores.abstention_correct === false) {
    if (scenario.probe.should_abstain && !result.abstained) {
      failures.push("false_confidence");
    }
    if (!scenario.probe.should_abstain && result.abstained) {
      failures.push("retrieval_miss");
    }
  }

  return [...new Set(failures)];
}

function attributeFailure(
  scores: ScenarioScores,
  mode: EvaluationMode
): AttributionLayer | null {
  if (mode === "no_memory") return null;

  if (scores.drift_detected === false || scores.provenance_complete === false) {
    return "state";
  }

  if (!scores.recall_correct && scores.update_fidelity !== false) {
    return "retrieval";
  }

  if (scores.recall_correct && scores.constraint_respected === false) {
    return "agent_policy";
  }

  return null;
}

function buildOracleState(scenario: Scenario): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const event of scenario.memory_events) {
    if (event.should_persist) {
      state[event.id] = event.value;
    }
  }
  return state;
}

export function aggregateScores(
  results: ScenarioResult[]
): AggregateScores {
  const n = results.length;
  if (n === 0) {
    return {
      recall_accuracy: 0,
      update_fidelity: 0,
      drift_rate: 0,
      detectability: 0,
      temporal_accuracy: 0,
      provenance_completeness: 0,
      constraint_consistency: 0,
      hallucination_rate: 0,
      abstention_quality: 0,
      scenarios_evaluated: 0,
    };
  }

  const count = (
    field: keyof ScenarioScores,
    target: boolean
  ): number => {
    const applicable = results.filter(
      (r) => r.scores[field] !== null
    );
    if (applicable.length === 0) return 0;
    return (
      applicable.filter((r) => r.scores[field] === target).length /
      applicable.length
    );
  };

  return {
    recall_accuracy: count("recall_correct", true),
    update_fidelity: count("update_fidelity", true),
    drift_rate: 1 - count("drift_detected", true),
    detectability: count("drift_detected", true),
    temporal_accuracy: count("temporal_correct", true),
    provenance_completeness: count("provenance_complete", true),
    constraint_consistency: count("constraint_respected", true),
    hallucination_rate: count("hallucination_detected", true),
    abstention_quality: count("abstention_correct", true),
    scenarios_evaluated: n,
  };
}
