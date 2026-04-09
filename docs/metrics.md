# WRIT Metric Definitions

## Core Metrics

### Recall Accuracy

**Definition:** The fraction of scenarios where the system's response contains the expected current value.

**Formula:** `recall_accuracy = count(recall_correct = true) / count(all scenarios)`

**Evaluation methods:**
- **Exact match:** Case-insensitive substring check — `answer.includes(expected)`
- **Structured match:** All `required_elements` present in the answer — `matched / total >= 0.8`
- **LLM judge:** External model grades the response against a rubric prompt

Specified per-scenario via `ground_truth.eval_rubric.method`.

---

### Update Fidelity

**Definition:** When a fact has changed, whether the response reflects the current value (not a stale one).

**Formula:** `update_fidelity = count(update_fidelity = true) / count(value_history.length > 1)`

Only evaluated when `ground_truth.value_history` has 2+ entries. The check:
1. Answer must contain the current value
2. If stale values also appear, the current value must not be positioned after them (the response should not present stale values as current)

---

### Drift Rate

**Definition:** The fraction of mutable facts where the system fails to track changes over time.

**Formula:** `drift_rate = 1 - count(drift_detected = true) / count(mutable events exist)`

A system that tracks no history has drift_rate = 1.0 (all changes are invisible). Drift is detected when `getHistory()` returns a `FactHistory` with multiple values and the current value matches ground truth.

Requires adapter capability: `supports_history`.

---

### Detectability

**Definition:** Inverse of drift rate — the fraction of mutable facts where the system can demonstrate change tracking.

**Formula:** `detectability = count(drift_detected = true) / count(mutable events exist)`

---

### Temporal Accuracy

**Definition:** Whether the system can reconstruct a fact's value as of a specific past date.

**Formula:** `temporal_accuracy = count(temporal_correct = true) / count(scenarios with temporal_query)`

The evaluator:
1. Calls `adapter.getStateAsOf(factId, as_of_timestamp)`
2. Finds the expected value from `ground_truth.value_history` that was active at that timestamp
3. Compares the returned value against the expected value

Only evaluated when `probe.temporal_query.as_of` is set. Requires adapter capability: `supports_temporal_replay`.

---

### Provenance Completeness

**Definition:** Whether the system can trace a fact back to its source session and message.

**Formula:** `provenance_completeness = count(provenance_complete = true) / count(scenarios requiring provenance_tracing)`

The evaluator:
1. Calls `adapter.getProvenance(factId)`
2. Checks that `provenance.source_session` matches `ground_truth.provenance.source_session`
3. Checks that `provenance.source_message_index` matches `ground_truth.provenance.source_message_index`

Requires adapter capability: `supports_provenance`.

---

### Constraint Consistency

**Definition:** Whether the system applies remembered constraints (preferences, rules, restrictions) when generating responses.

**Formula:** `constraint_consistency = count(constraint_respected = true) / count(scenarios requiring constraint_application)`

Evaluated using `ground_truth.constraint_check`:
- `must_contain`: All listed terms must appear in the answer
- `must_not_contain`: None of the listed terms may appear in the answer

Falls back to `!abstained && recall_correct` if no `constraint_check` is defined.

---

### Hallucination Rate

**Definition:** The fraction of scenarios where the response contains information not grounded in any known value from the scenario.

**Formula:** `hallucination_rate = count(hallucination_detected = true) / count(all scenarios)`

The check builds a set of all known values (current value, historical values, all memory event values) and verifies the answer contains at least one of them. If the answer is non-empty but contains no known value, it is flagged as a hallucination.

---

### Abstention Quality

**Definition:** Whether the system correctly abstains when it should, and does not abstain when it should not.

**Formula:** `abstention_quality = count(abstention_correct = true) / count(all scenarios)`

- When `probe.should_abstain = true`: the system should produce `abstained = true`
- When `probe.should_abstain = false`: the system should produce `abstained = false`

---

## Diagnostic Scores

### Recall Score (per-scenario)

A numeric 0.0-1.0 score for partial credit on individual scenarios:
- Exact/substring match: 1.0 or 0.0
- Structured match: `matched_elements / total_elements`
- LLM judge: `partial_score` from the judge's verdict

---

## Failure Attribution

Each failing scenario is attributed to one of three layers:

| Layer | Trigger |
|-------|---------|
| **State** | `drift_detected = false` OR `provenance_complete = false` — the memory infrastructure lost data |
| **Retrieval** | `recall_correct = false` AND `update_fidelity != false` — data exists but was not found |
| **Agent Policy** | `recall_correct = true` AND `constraint_respected = false` — data was found but misapplied |

---

## Aggregation

All aggregate metrics use the same formula: count the scenarios where the metric is applicable (not `null`), then compute the fraction meeting the target condition.

Metrics that return `null` (because the adapter lacks the capability or the scenario does not test that dimension) are excluded from aggregation — they do not penalize or inflate scores.
