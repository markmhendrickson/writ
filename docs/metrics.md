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

---

### Source Authority Integrity

**Definition:** Whether the system prevents lower-authority sources from silently overwriting higher-authority facts. A user-stated fact overwritten by an LLM summary is scored as a failure.

**Formula:** `source_authority_integrity = count(source_authority_intact = true) / count(scenarios requiring source_authority_tracking)`

Only evaluated when `source_authority_tracking` is in `probe.required_capabilities`. The check verifies that the system returns the value from the highest-authority source, not the most recent write.

Requires adapter capability: `supports_source_authority`.

---

### Dedup Accuracy

**Definition:** Whether the system correctly consolidates near-duplicate entities from varied extraction phrasing into a single canonical entity.

**Formula:** `dedup_accuracy = count(dedup_correct = true) / count(scenarios requiring deduplication)`

Only evaluated when `deduplication` is in `probe.required_capabilities`. Scenarios specify `expected_entity_count` in ground truth; the system should not create more entities than expected.

Requires adapter capability: `supports_deduplication`.

---

### Failure Resilience

**Definition:** The fraction of failure injection scenarios where the system either prevented data corruption or detected and flagged the issue. Tests resilience to flush failures, stale tool outputs, concurrent writes, and session corruption.

**Formula:** `failure_resilience = count(failure_resilient = true) / count(failure_injection scenarios)`

Evaluated for all scenarios in the `failure_injection` category.

---

### Lifecycle Accuracy

**Definition:** Whether the system can distinguish between active, superseded, expired, and reinstated facts. A system that returns a superseded or expired fact as current fails.

**Formula:** `lifecycle_accuracy = count(lifecycle_current_correct = true) / count(scenarios requiring lifecycle_awareness)`

Only evaluated when `lifecycle_awareness` is in `probe.required_capabilities`. Scenarios include `lifecycle_history` in ground truth showing state transitions.

Requires adapter capability: `supports_lifecycle`.

---

### Pre-Delivery Detection

**Definition:** Whether the system flags integrity issues (staleness, conflicts, temporal mismatches) before delivering results, rather than silently returning potentially incorrect data.

**Formula:** `pre_delivery_detection = count(pre_delivery_flagged = true) / count(scenarios requiring pre_delivery_certification)`

Only evaluated when `pre_delivery_certification` is in `probe.required_capabilities`. Scenarios specify `expected_integrity_flag` in ground truth.

Requires adapter capability: `supports_pre_delivery_certification`.

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
