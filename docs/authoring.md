# Authoring WRIT Scenarios

## File Format

Each scenario is a single JSON file in `scenarios/`. Filename convention: `{category}-{NNN}-{slug}.json`.

## Required Fields

```json
{
  "scenario_id": "drift-006-insurance-change",
  "version": "1.0.0",
  "category": "drift",
  "description": "Short description of what this scenario tests.",
  "sessions": [],
  "memory_events": [],
  "probe": {},
  "ground_truth": {},
  "failure_modes": [],
  "interference": []
}
```

### `scenario_id`

Format: `{category}-{NNN}-{slug}` where NNN is a zero-padded number. Must be unique across all scenarios.

### `version`

Always `"1.0.0"` for the initial dataset release.

### `category`

One of: `drift`, `temporal`, `provenance`, `constraint`, `entity`, `forgetting`, `update`, `multi_hop`, `abstention`, `work_state`.

### `sessions`

Array of conversation sessions, each with:

```json
{
  "session_id": 1,
  "timestamp": "2026-01-15T10:00:00Z",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

- Minimum 3 sessions, target 5-8
- Timestamps must be chronological and span realistic time gaps (days to months)
- Include noise sessions (unrelated conversation) between fact-bearing sessions to test robustness

### `memory_events`

Each event represents a fact the system should track:

```json
{
  "id": "employer",
  "type": "mutable",
  "value": "current value",
  "introduced_in": 1,
  "updated_in": 3,
  "retracted_in": null,
  "should_persist": true,
  "previous_values": [
    { "value": "old value", "as_of": "2026-01-15T10:00:00Z", "source_session": 1 }
  ]
}
```

**Memory event types:**
| Type | Description | Example |
|------|-------------|---------|
| `explicit` | Clearly stated fact | "My name is Alice" |
| `mutable` | Fact that changes over time | Employer, address |
| `latent` | Implicit preference or constraint | Dairy avoidance |
| `entity` | Person, place, or linked object | "Alex is my manager" |
| `work_state` | Ongoing task, project, checklist | Task list status |
| `non_memory` | Should NOT persist | "Don't remember this" |

### `probe`

The question asked at the end:

```json
{
  "session": 5,
  "prompt": "What is my current employer?",
  "required_capabilities": ["retrieval", "update_tracking"],
  "temporal_query": null,
  "should_abstain": false
}
```

- `session`: which session the probe occurs in (must exist in sessions)
- `required_capabilities`: which capabilities are tested
- `temporal_query`: set `{ "as_of": "2026-03-15T00:00:00Z", "expect_current": false }` for temporal scenarios
- `should_abstain`: `true` for abstention scenarios

### `ground_truth`

The expected correct answer:

```json
{
  "current_value": "Initech",
  "value_history": [
    { "value": "Acme Corp", "as_of": "2026-01-15T10:00:00Z", "source_session": 1 },
    { "value": "Initech", "as_of": "2026-03-01T10:00:00Z", "source_session": 2 }
  ],
  "provenance": {
    "source_session": 2,
    "source_message_index": 0,
    "agent_or_user": "user"
  },
  "eval_rubric": {
    "method": "exact"
  }
}
```

### `eval_rubric`

Controls how the answer is graded:

| Method | When to use | Fields |
|--------|-------------|--------|
| `"exact"` | Single-value recall | None required |
| `"structured"` | Multi-value recall | `required_elements: string[]` |
| `"llm_judge"` | Open-ended or nuanced | `rubric_prompt: string` |

Example structured rubric:
```json
{
  "method": "structured",
  "required_elements": ["Acme Corp", "Initech", "Globex"]
}
```

Example LLM judge rubric:
```json
{
  "method": "llm_judge",
  "rubric_prompt": "Does the response accurately describe the full employment history, listing all employers in chronological order?"
}
```

### `constraint_check`

For constraint scenarios, define what the answer must and must not contain:

```json
{
  "must_contain": ["sorbet", "fruit"],
  "must_not_contain": ["cream", "cheese", "milk", "butter"]
}
```

### `failure_modes`

List which failures this scenario is designed to detect:

Valid modes: `stale_memory`, `missing_memory`, `incorrect_generalization`, `memory_hallucination`, `constraint_violation`, `retrieval_miss`, `over_retention`, `false_confidence`, `silent_drift`, `provenance_loss`.

### `interference`

Optional array of distractors embedded in the scenario:

```json
[
  {
    "type": "near_duplicate",
    "session": 3,
    "content": "My colleague also moved to Portland"
  },
  {
    "type": "contradicting",
    "session": 4,
    "content": "Assistant incorrectly states user still lives in old city"
  }
]
```

Types: `near_duplicate`, `contradicting`, `low_salience`, `distractor`.

## Validation

Run `npx vitest run tests/scenarios/validate_all.test.ts` to validate all scenarios. The validation checks:
- Required fields present
- Session IDs referenced correctly
- Memory event types are valid
- Timestamps are chronological
- At least 3 sessions per scenario
- Category-specific requirements (abstention has `should_abstain=true`, constraints have `constraint_application` capability)

## Guidelines

1. **Realistic conversation.** Scenarios should read like plausible multi-session interactions, not test fixtures.
2. **One primary test per scenario.** Each scenario should have a clear thesis about what it tests.
3. **Include noise.** Add sessions with unrelated conversation between fact-bearing sessions.
4. **Time gaps matter.** Use realistic gaps between sessions (days, weeks, months) to test temporal resilience.
5. **Interference strengthens the test.** Add near-duplicate facts, contradicting assistant statements, and low-salience mentions.
6. **Ground truth must be unambiguous.** The correct answer should be derivable from the scenario content alone.
