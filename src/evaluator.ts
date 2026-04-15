import type { MemoryAdapter, AdapterCapabilities } from "./adapter.js";
import type {
  Scenario,
  ScenarioResult,
  ScenarioScores,
  EvaluationMode,
  FailureMode,
  AttributionLayer,
  AggregateScores,
  ProbeResult,
  JudgeVerdict,
} from "./types.js";
import { judge } from "./judge.js";

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
      mode === "oracle_memory" ? buildOracleState(scenario) : undefined,
  });

  const capabilities = adapter.getCapabilities();
  const scores = await scoreResult(scenario, adapter, probeResult, capabilities);
  const detectedFailures = detectFailures(scenario, scores, probeResult);
  const attribution = attributeFailure(scores, mode);

  return {
    scenario_id: scenario.scenario_id,
    category: scenario.category,
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
  result: ProbeResult,
  capabilities: AdapterCapabilities
): Promise<ScenarioScores> {
  const gt = scenario.ground_truth;
  const rubric = gt.eval_rubric;

  let recall_correct: boolean;
  let recall_score: number;

  if (rubric?.method === "llm_judge" && rubric.rubric_prompt) {
    const verdict = await judgeRecall(result, gt.current_value, rubric.rubric_prompt);
    recall_correct = verdict.correct;
    recall_score = verdict.partial_score;
  } else if (rubric?.method === "structured" && rubric.required_elements) {
    const { correct, score } = checkStructuredRecall(
      result,
      rubric.required_elements
    );
    recall_correct = correct;
    recall_score = score;
  } else {
    recall_correct = checkRecall(result, gt.current_value);
    recall_score = recall_correct ? 1.0 : 0.0;
  }

  let update_fidelity: boolean | null = null;
  if (gt.value_history.length > 1) {
    update_fidelity = checkUpdateFidelity(result, gt);
  }

  let drift_detected: boolean | null = null;
  if (!capabilities.supports_history) {
    drift_detected = null;
  } else {
    const mutableEvent = scenario.memory_events.find(
      (e) => e.type === "mutable"
    );
    if (mutableEvent) {
      const history = await adapter.getHistory(mutableEvent.id);
      drift_detected =
        history !== null &&
        history.values.length > 1 &&
        matchesCurrentValue(history.current_value, gt.current_value);
    }
  }

  let temporal_correct: boolean | null = null;
  if (!capabilities.supports_temporal_replay) {
    temporal_correct = null;
  } else if (scenario.probe.temporal_query?.as_of) {
    const targetTimestamp = scenario.probe.temporal_query.as_of;
    const asOfValue = await adapter.getStateAsOf(
      scenario.memory_events[0]!.id,
      targetTimestamp
    );

    if (asOfValue === null) {
      temporal_correct = false;
    } else {
      const expectedEntry = findExpectedValueAsOf(
        gt.value_history,
        targetTimestamp
      );
      temporal_correct = expectedEntry
        ? matchesCurrentValue(asOfValue, expectedEntry.value)
        : asOfValue !== null;
    }
  }

  let provenance_complete: boolean | null = null;
  if (!capabilities.supports_provenance) {
    provenance_complete = null;
  } else if (
    scenario.probe.required_capabilities.includes("provenance_tracing")
  ) {
    const prov = await adapter.getProvenance(scenario.memory_events[0]!.id);
    if (!prov || prov.chain.length === 0) {
      provenance_complete = false;
    } else {
      provenance_complete =
        prov.source_session === gt.provenance.source_session &&
        prov.source_message_index === gt.provenance.source_message_index;
    }
  }

  let constraint_respected: boolean | null = null;
  if (
    scenario.probe.required_capabilities.includes("constraint_application")
  ) {
    const check = gt.constraint_check;
    if (check) {
      constraint_respected = evaluateConstraint(result, check);
    } else {
      constraint_respected = !result.abstained && recall_correct;
    }
  }

  let abstention_correct: boolean | null = null;
  if (scenario.probe.should_abstain) {
    abstention_correct = result.abstained;
  } else {
    abstention_correct = !result.abstained;
  }

  const hallucination_detected = checkHallucination(result, scenario);

  let source_authority_intact: boolean | null = null;
  if (
    capabilities.supports_source_authority &&
    scenario.probe.required_capabilities.includes("source_authority_tracking")
  ) {
    const authorityEvent = scenario.memory_events.find(
      (e) => e.source_authority !== undefined
    );
    if (authorityEvent) {
      source_authority_intact = recall_correct;
    }
  }

  let dedup_correct: boolean | null = null;
  if (
    capabilities.supports_deduplication &&
    scenario.probe.required_capabilities.includes("deduplication")
  ) {
    const expectedCount = scenario.ground_truth.expected_entity_count;
    if (expectedCount !== undefined) {
      dedup_correct = recall_correct;
    }
  }

  let failure_resilient: boolean | null = null;
  if (scenario.category === "failure_injection") {
    failure_resilient = recall_correct;
  }

  let lifecycle_current_correct: boolean | null = null;
  let lifecycle_temporal_correct: boolean | null = null;
  if (
    scenario.probe.required_capabilities.includes("lifecycle_awareness")
  ) {
    lifecycle_current_correct = recall_correct;

    if (scenario.probe.temporal_query?.as_of && capabilities.supports_temporal_replay) {
      const targetTimestamp = scenario.probe.temporal_query.as_of;
      const asOfValue = await adapter.getStateAsOf(
        scenario.memory_events[0]!.id,
        targetTimestamp
      );
      if (asOfValue === null) {
        lifecycle_temporal_correct = false;
      } else {
        const expectedEntry = findExpectedValueAsOf(
          gt.value_history,
          targetTimestamp
        );
        lifecycle_temporal_correct = expectedEntry
          ? matchesCurrentValue(asOfValue, expectedEntry.value)
          : asOfValue !== null;
      }
    }
  }

  let pre_delivery_flagged: boolean | null = null;
  if (
    scenario.probe.required_capabilities.includes("pre_delivery_certification")
  ) {
    const expectFlag = scenario.ground_truth.expected_integrity_flag;
    if (expectFlag !== undefined) {
      pre_delivery_flagged = result.confidence !== null && result.confidence < 1.0
        ? expectFlag
        : !expectFlag;
    }
  }

  return {
    recall_correct,
    recall_score,
    update_fidelity,
    drift_detected,
    temporal_correct,
    provenance_complete,
    constraint_respected,
    abstention_correct,
    hallucination_detected,
    source_authority_intact,
    dedup_correct,
    failure_resilient,
    lifecycle_current_correct,
    lifecycle_temporal_correct,
    pre_delivery_flagged,
  };
}

function checkRecall(result: ProbeResult, expected: unknown): boolean {
  if (result.abstained) return false;
  const answer = result.answer.toLowerCase();

  if (typeof expected === "string" || typeof expected === "number") {
    return answer.includes(String(expected).toLowerCase());
  }

  if (Array.isArray(expected)) {
    return expected.every((item) =>
      answer.includes(String(item).toLowerCase())
    );
  }

  if (typeof expected === "object" && expected !== null) {
    return Object.values(expected).every((val) =>
      answer.includes(String(val).toLowerCase())
    );
  }

  return answer.includes(String(expected).toLowerCase());
}

function checkStructuredRecall(
  result: ProbeResult,
  requiredElements: string[]
): { correct: boolean; score: number } {
  if (result.abstained) return { correct: false, score: 0 };
  const answer = result.answer.toLowerCase();
  let matched = 0;
  for (const element of requiredElements) {
    if (answer.includes(element.toLowerCase())) {
      matched++;
    }
  }
  const score = requiredElements.length > 0 ? matched / requiredElements.length : 0;
  return { correct: score >= 0.8, score };
}

async function judgeRecall(
  result: ProbeResult,
  expected: unknown,
  rubricPrompt: string
): Promise<JudgeVerdict> {
  if (result.abstained) {
    return { correct: false, partial_score: 0, reasoning: "Model abstained" };
  }
  return judge({
    probe_answer: result.answer,
    expected_value: expected,
    rubric_prompt: rubricPrompt,
  });
}

function checkUpdateFidelity(
  result: ProbeResult,
  gt: { current_value: unknown; value_history: { value: unknown }[] }
): boolean {
  if (result.abstained) return false;
  const answer = result.answer.toLowerCase();
  const currentStr = String(gt.current_value).toLowerCase();

  if (!answer.includes(currentStr)) return false;

  if (gt.value_history.length >= 2) {
    const staleValues = gt.value_history.slice(0, -1);
    const mentionsStale = staleValues.some((entry) =>
      answer.includes(String(entry.value).toLowerCase())
    );
    if (mentionsStale) {
      const currentIdx = answer.indexOf(currentStr);
      const lastStaleIdx = Math.max(
        ...staleValues.map((e) =>
          answer.lastIndexOf(String(e.value).toLowerCase())
        )
      );
      if (lastStaleIdx > currentIdx) return false;
    }
  }

  return true;
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
  for (const event of scenario.memory_events) {
    allValues.add(String(event.value).toLowerCase());
    for (const pv of event.previous_values) {
      allValues.add(String(pv.value).toLowerCase());
    }
  }

  const answer = result.answer.toLowerCase();
  const containsKnownValue = [...allValues].some((v) => answer.includes(v));

  return !containsKnownValue && answer.length > 0;
}

function evaluateConstraint(
  result: ProbeResult,
  check: { must_contain?: string[]; must_not_contain?: string[] }
): boolean {
  if (result.abstained) return false;
  const answer = result.answer.toLowerCase();

  if (check.must_contain) {
    for (const term of check.must_contain) {
      if (!answer.includes(term.toLowerCase())) return false;
    }
  }

  if (check.must_not_contain) {
    for (const term of check.must_not_contain) {
      if (answer.includes(term.toLowerCase())) return false;
    }
  }

  return true;
}

function findExpectedValueAsOf(
  history: { value: unknown; as_of: string }[],
  targetTimestamp: string
): { value: unknown; as_of: string } | null {
  const target = new Date(targetTimestamp).getTime();
  let best: { value: unknown; as_of: string } | null = null;

  for (const entry of history) {
    const entryTime = new Date(entry.as_of).getTime();
    if (entryTime <= target) {
      if (!best || entryTime > new Date(best.as_of).getTime()) {
        best = entry;
      }
    }
  }
  return best;
}

function matchesCurrentValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;

  const actualStr = typeof actual === "object"
    ? JSON.stringify(actual)
    : String(actual);
  const expectedStr = typeof expected === "object"
    ? JSON.stringify(expected)
    : String(expected);

  return actualStr.toLowerCase().includes(expectedStr.toLowerCase()) ||
    expectedStr.toLowerCase().includes(actualStr.toLowerCase());
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

  if (scores.source_authority_intact === false) {
    failures.push("authority_violation");
  }

  if (scores.dedup_correct === false) {
    failures.push("extraction_drift");
  }

  if (scores.failure_resilient === false) {
    failures.push("flush_corruption");
  }

  if (scores.lifecycle_current_correct === false) {
    failures.push("lifecycle_blindness");
  }

  if (scores.pre_delivery_flagged === false) {
    failures.push("certification_miss");
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

  if (scores.source_authority_intact === false || scores.lifecycle_current_correct === false || scores.failure_resilient === false) {
    return "state";
  }

  if (!scores.recall_correct && scores.update_fidelity !== false) {
    return "retrieval";
  }

  if (scores.dedup_correct === false) {
    return "retrieval";
  }

  if (scores.recall_correct && scores.constraint_respected === false) {
    return "agent_policy";
  }

  if (scores.pre_delivery_flagged === false) {
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
      source_authority_integrity: 0,
      dedup_accuracy: 0,
      failure_resilience: 0,
      lifecycle_accuracy: 0,
      pre_delivery_detection: 0,
      scenarios_evaluated: 0,
    };
  }

  const count = (
    field: keyof ScenarioScores,
    target: boolean
  ): number => {
    const applicable = results.filter(
      (r) => r.scores[field] != null
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
    source_authority_integrity: count("source_authority_intact", true),
    dedup_accuracy: count("dedup_correct", true),
    failure_resilience: count("failure_resilient", true),
    lifecycle_accuracy: count("lifecycle_current_correct", true),
    pre_delivery_detection: count("pre_delivery_flagged", true),
    scenarios_evaluated: n,
  };
}
