# WORKMEM

**Not what the model remembers -- what it can still do with it.**

WORKMEM evaluates whether an AI system can maintain correct, usable, and evolving state over time across multi-session interactions. It measures memory as persistence, update correctness, constraint application, and reliability under noise and time gaps.

No widely used AI memory benchmark tests what happens to stored data after agents write to it. Retrieval metrics (recall@k, precision, latency) are necessary but not sufficient. WORKMEM tests the failure modes that retrieval benchmarks miss: silent drift, lost history, broken provenance, and undetectable corruption.

Inspired by [No AI memory benchmark tests what actually breaks](https://markmhendrickson.com/posts/no-ai-memory-benchmark-tests-what-actually-breaks/).

## Scope

**Included:**
- Multi-session conversational memory (5-20 sessions per scenario)
- Structured and unstructured state
- Agent + memory system behavior as a unit
- Write integrity over time
- Temporal state reconstruction

**Excluded:**
- Single-turn QA
- Pure retrieval accuracy on static corpora
- Static long-context window tests

## Core Concepts

### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| **Explicit Facts** | Clearly stated user information | "My email is mark@example.com" |
| **Mutable Facts** | Facts that change over time | "I work at Acme" -> "I work at Initech" |
| **Latent Constraints** | Implicit preferences and goals | User always declines dairy -> dairy allergy inferred |
| **Work State** | Ongoing plans, tasks, or workflows | Multi-step project with dependencies |
| **Entities & Relationships** | People, places, and linked objects | "Sarah is my cofounder. She lives in Berlin." |
| **Non-Memory** | Information that should not persist | Ephemeral instructions, one-time context |

### Two Failure Modes

**Hallucination** is model-level: the LLM generates content with no basis in its input. The retrieval was fine. The generation went wrong.

**Memory corruption** is infrastructure-level: the stored data is wrong. The model retrieves it faithfully. The answer looks correct because the retrieval was correct. What was retrieved had changed. Memory corruption passes every hallucination guardrail.

WORKMEM tests both, and requires systems to distinguish between them.

## Scenario Structure

Each scenario consists of:

1. **Conversation timeline** -- 5-20 sessions with temporal gaps
2. **Memory events** -- facts introduced, updated, contradicted, or retracted
3. **Interference** -- noise, near-duplicate distractors, conflicting updates
4. **Probe task** -- a question or action that requires correct memory state
5. **Evaluation** -- ground truth, required capabilities, acceptable failure modes

## Data Schema

```json
{
  "scenario_id": "string",
  "version": "1.0.0",
  "category": "drift|temporal|provenance|constraint|entity|forgetting",
  "sessions": [
    {
      "session_id": 1,
      "timestamp": "ISO-8601",
      "messages": [
        { "role": "user|assistant", "content": "string" }
      ]
    }
  ],
  "memory_events": [
    {
      "id": "string",
      "type": "explicit|mutable|latent|entity|work_state|non_memory",
      "value": "any",
      "introduced_in": 1,
      "updated_in": null,
      "retracted_in": null,
      "should_persist": true,
      "previous_values": []
    }
  ],
  "probe": {
    "session": 10,
    "prompt": "string",
    "required_capabilities": ["retrieval", "update_tracking", "constraint_application"],
    "temporal_query": {
      "as_of": "ISO-8601 | null",
      "expect_current": true
    },
    "should_abstain": false
  },
  "ground_truth": {
    "current_value": "any",
    "value_history": [
      { "value": "any", "as_of": "ISO-8601", "source_session": 1 }
    ],
    "provenance": {
      "source_session": 1,
      "source_message_index": 0,
      "agent_or_user": "user"
    }
  },
  "failure_modes": ["stale_memory", "missing_memory", "hallucinated_memory"]
}
```

## Capability Categories

| Category | Tests |
|----------|-------|
| **Retrieval** | Can the system find a stored fact? |
| **Update Handling** | When a fact changes, does the system use the current value? |
| **History Preservation** | Are previous values of a fact still accessible? |
| **Temporal Replay** | Can the system reconstruct state as of a past date? |
| **Provenance** | Can the system trace a fact to its source session and input? |
| **Constraint Inference** | Does the system apply implicit preferences correctly? |
| **Multi-hop Reasoning** | Can the system combine multiple stored facts? |
| **Selective Forgetting** | Does the system correctly drop non-persistent information? |
| **Abstention** | Does the system decline to answer when memory is insufficient? |

## Failure Modes

| Failure Mode | Description |
|--------------|-------------|
| **Stale Memory** | Using an outdated value when a newer one exists |
| **Missing Memory** | Failing to recall a fact that was stored |
| **Incorrect Generalization** | Over-applying a fact to wrong contexts |
| **Memory Hallucination** | Producing a "remembered" fact that was never stored |
| **Constraint Violation** | Acting against an inferred or explicit preference |
| **Retrieval Miss** | Fact exists but retrieval fails to surface it |
| **Over-retention** | Persisting information that should have been forgotten |
| **False Confidence** | High confidence on wrong or stale data |
| **Silent Drift** | Value changed with no record of the change |
| **Provenance Loss** | Fact exists but source cannot be traced |

## Metrics

### Core Metrics (every system reports these)

| Metric | Definition |
|--------|------------|
| **Recall Accuracy** | Fraction of stored facts correctly retrieved on probe |
| **Update Fidelity** | Fraction of mutable facts reflecting the latest value |
| **Drift Rate** | Fraction of values that changed without explicit user correction |
| **Detectability** | For each drift, can the system show when, what, and the previous value? |
| **Constraint Consistency** | Fraction of probes where inferred constraints are correctly applied |
| **Application Correctness** | Fraction of probes where the correct action is taken given memory |
| **Abstention Quality** | Precision/recall of declining to answer when memory is insufficient |

### Diagnostic Metrics

| Metric | Definition |
|--------|------------|
| **Stale Usage Rate** | Fraction of probes returning outdated values |
| **Hallucination Rate** | Fraction of probes returning values never stored |
| **Distractor Sensitivity** | Performance degradation when near-duplicate distractors are present |
| **Temporal Accuracy** | Correctness of as-of-date state reconstruction |
| **Provenance Completeness** | Fraction of facts with traceable source chain |
| **Over-retention Rate** | Fraction of non-memory items that persist |

## Evaluation Modes

Each scenario is run in three modes to isolate failure attribution:

| Mode | Description | Purpose |
|------|-------------|---------|
| **No Memory** | System receives only the probe, no prior context | Baseline: what the model invents |
| **Native Memory** | System uses its own memory after processing all sessions | Production behavior |
| **Oracle Memory** | System receives perfect ground-truth memory state | Ceiling: isolates model from memory failures |

Comparing modes:
- Native < Oracle = memory system failure (storage, retrieval, or representation)
- Native < No Memory = memory system actively harms performance
- Oracle < perfect = model failure even with correct memory

## Anti-Cheat Design

Scenarios include:
- **Near-duplicate distractors** -- similar but distinct facts to test precision
- **Indirect cues** -- facts that must be inferred, not pattern-matched
- **Conflicting updates** -- same field updated by different sessions
- **Low-salience facts** -- important details buried in long conversations
- **Implicit constraints** -- preferences never stated as rules

## Scoring

Multi-dimensional scoring is required. A single aggregate score hides the failure modes that matter.

Example scorecard:

| Metric | Score |
|--------|-------|
| Recall Accuracy | 82% |
| Update Fidelity | 47% |
| Drift Rate | 12% |
| Detectability | 23% |
| Temporal Accuracy | 31% |
| Provenance Completeness | 15% |
| Constraint Consistency | 61% |
| Hallucination Rate | 18% |
| Abstention Quality | 22% |

The example above would indicate: retrieval works, but the system silently drifts, cannot reconstruct past state, and loses provenance. This is the profile the blog post describes.

## System Decomposition

Failures must be attributed to one of three layers:

| Layer | Responsibility | Example Failure |
|-------|---------------|-----------------|
| **State Layer** | Persistence, immutability, versioning | Value silently overwritten |
| **Retrieval Layer** | Finding relevant facts given a query | Correct value exists but not surfaced |
| **Agent Policy Layer** | Deciding what to do with retrieved facts | Correct value retrieved but wrong action taken |

## Dataset Composition

- 70% synthetic scenarios (programmatically generated, deterministic ground truth)
- 30% human-authored scenarios (realistic conversation patterns, edge cases)

## Use Cases

- **Evaluating memory systems** -- Compare architectures on write integrity, not just retrieval
- **TDD for memory infrastructure** -- Regression tests for systems that claim immutability or versioning
- **Agent instruction tuning** -- Test whether agent policies degrade memory over time
- **Industry transparency** -- Publish comparable results across systems

## How WORKMEM Compares to Existing Benchmarks

Every widely used AI memory benchmark tests retrieval: can the system find a stored fact? None test write integrity: is the stored fact still correct after agents write to it?

### Benchmark Landscape

| Benchmark | Scale | What it tests | What it misses |
|-----------|-------|---------------|----------------|
| **[LoCoMo](https://github.com/snap-research/locomo)** (ACL 2024) | ~16K tokens, 10 conversations, 32 sessions | Multi-session QA, event summarization, temporal reasoning | Static corpus. Facts don't change. No write operations. |
| **[LongMemEval](https://github.com/xiaowu0162/LongMemEval)** (ICLR 2025) | 115K-1.5M tokens, 500 questions | Information extraction, multi-session reasoning, knowledge updates, abstention | Conversations are pre-generated. The system ingests but never writes back. No drift, no provenance, no corruption. |
| **[BEAM](https://github.com/mohammadtavakoli78/BEAM)** (ICLR 2026) | 128K-10M tokens, 2000 questions | Retrieval at scale where context-stuffing fails. Multi-domain, multi-hop. | Tests whether you can find the needle in 10M tokens. Does not test whether the needle changed since you stored it. |
| **[AMB](https://agentmemorybenchmark.ai/)** (Vectorize, 2026) | Meta-benchmark aggregating LoCoMo, LongMemEval, LifeBench, PersonaMem | Multi-dataset accuracy, speed, cost comparison across memory systems | Inherits retrieval focus from component datasets. Acknowledges gaps: "none of the current datasets stress memory at scale, none test agentic settings where the agent decides what to retain." |
| **WORKMEM** | 5-20 sessions per scenario, temporal gaps of days to months | **Write integrity**: drift rate, detectability, temporal replay, provenance, update fidelity, selective forgetting | Higher cost per scenario. Partial human evaluation. Harder to standardize constraint inference scoring. |

### The Gap

All four established benchmarks share a design assumption: the corpus is static. The system ingests conversations, then answers questions about them. Facts do not change between ingestion and query. The system never writes to its own memory in a way that could corrupt previous facts.

This matches how memory systems were evaluated when context windows were small and retrieval was the hard problem. It does not match how memory systems fail in production, where agents write state across sessions, facts change, corrections overwrite previous values, and summarization merges records.

The [DEV Community analysis "What Memory Benchmarks Don't Test"](https://dev.to/esteyang/what-memory-benchmarks-dont-test-h9c) (March 2026) identifies three failure modes LoCoMo cannot catch: confident retrieval of stale beliefs, unresolved contradictions surfaced as equivalent facts, and absence of trust decay over time. WORKMEM tests all three.

### Complementary, Not Competing

WORKMEM does not replace retrieval benchmarks. Good retrieval is necessary. A system that cannot find stored facts will fail WORKMEM too (recall accuracy is a core metric).

The relationship:

| | Retrieval benchmarks (LoCoMo, LongMemEval, BEAM) | WORKMEM |
|---|---|---|
| **Question** | Can you find the right fact? | Is the fact you found still correct? |
| **Failure mode** | Retrieval miss | Silent corruption |
| **Root cause** | Embedding quality, chunk boundaries, attention degradation | Last-write-wins, summarization loss, provenance gaps |
| **Architecture tested** | Retrieval pipeline (semantic, BM25, graph, temporal) | State layer (immutability, versioning, provenance) |
| **Scale threshold** | Matters most at >1M tokens (BEAM's insight) | Matters at first conflicting write (~100K tokens) |

A system can score 95%+ on LongMemEval and fail catastrophically on WORKMEM if it overwrites values on update, loses history, or cannot trace provenance. WORKMEM catches the failures that retrieval benchmarks structurally cannot detect.

## Design Principles

- **Realism over simplicity** -- Scenarios model real multi-session workflows
- **Failure analysis over ranking** -- Diagnose where systems break, not just which scores higher
- **Multi-session over single-turn** -- Memory only matters across time
- **Write integrity over read speed** -- The hard problem is keeping stored facts correct
- **Statefulness over stateless evaluation** -- Tests require persistent state across sessions

## Running

```bash
npm install
npm run benchmark -- --adapter neotoma --scenarios all
npm run benchmark -- --adapter neotoma --scenarios drift
npm run benchmark -- --adapter neotoma --scenarios temporal
npm run report
```

## Adapters

WORKMEM tests memory systems through adapters. Each adapter implements a standard interface:

```typescript
interface MemoryAdapter {
  name: string;
  init(): Promise<void>;
  processSession(session: Session): Promise<void>;
  probe(prompt: string, options?: ProbeOptions): Promise<ProbeResult>;
  getHistory(factId: string): Promise<FactHistory | null>;
  getStateAsOf(factId: string, timestamp: string): Promise<any>;
  getProvenance(factId: string): Promise<Provenance | null>;
  reset(): Promise<void>;
}
```

Built-in adapters:
- `neotoma` -- Tests Neotoma's observation-based memory with immutability and provenance
- `baseline` -- Naive key-value store (mutable, no history) for comparison

## Limitations

- Higher cost than traditional benchmarks (multi-session, stateful)
- Partial reliance on human evaluation for ambiguous probes
- Harder to standardize scoring for constraint inference

## Future Extensions

- Tool-use integration (agents that write to external systems)
- Multi-agent scenarios (concurrent writes, conflict resolution)
- Long-horizon tasks (weeks/months of simulated time)
- Domain-specific variants (financial, medical, legal)

## License

MIT
