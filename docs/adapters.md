# Implementing a WRIT Adapter

A WRIT adapter wraps a memory system so the benchmark can feed it conversation sessions, probe it for answers, and inspect its internal state.

## Interface

Implement the `MemoryAdapter` interface from `src/adapter.ts`:

```typescript
interface MemoryAdapter {
  readonly name: string;
  init(): Promise<void>;
  processSession(session: Session): Promise<void>;
  probe(prompt: string, options?: ProbeOptions): Promise<ProbeResult>;
  getHistory(factId: string): Promise<FactHistory | null>;
  getStateAsOf(factId: string, timestamp: string): Promise<unknown | null>;
  getProvenance(factId: string): Promise<Provenance | null>;
  getCapabilities(): AdapterCapabilities;
  reset(): Promise<void>;
  teardown(): Promise<void>;
}
```

## Methods

### `init()`

Called once before any scenarios run. Connect to the memory system, verify health, allocate resources.

### `processSession(session)`

Feed a conversation session into the memory system. The adapter should store facts, entities, and relationships exactly as the target system would in production.

The `session` object contains:
- `session_id`: numeric identifier
- `timestamp`: ISO 8601 timestamp for when the session occurred
- `messages`: array of `{ role: "user" | "assistant", content: string }`

Store the session's timestamp alongside any stored entities so temporal queries work correctly.

### `probe(prompt, options?)`

Ask the memory system a question. Return:
- `answer`: the system's textual response
- `confidence`: optional numeric confidence score (0-1)
- `cited_sources`: array of source identifiers the system referenced
- `abstained`: whether the system declined to answer

Handle three modes via `options.mode`:
- `"no_memory"`: Return an empty/abstained response without consulting memory
- `"native_memory"`: Query the system's actual memory
- `"oracle_memory"`: Use `options.oracle_state` (a `Record<string, unknown>` of fact_id -> value) instead of the system's own memory

### `getHistory(factId)`

Return the full value history for a stored fact. If the system does not track history, return `null`.

The `factId` comes from `scenario.memory_events[].id`. Map this to whatever internal identifier your system uses.

Return a `FactHistory`:
```typescript
{
  fact_id: string;
  values: Array<{ value: unknown; as_of: string; source_session: number }>;
  current_value: unknown;
}
```

### `getStateAsOf(factId, timestamp)`

Reconstruct a fact's value as it was at a specific point in time. If the system does not support temporal queries, return `null`.

### `getProvenance(factId)`

Return provenance metadata: which session, which message, and who (user/assistant) introduced the fact. If the system does not track provenance, return `null`.

Return a `Provenance`:
```typescript
{
  fact_id: string;
  source_session: number;
  source_message_index: number;
  agent_or_user: string;
  chain: ProvenanceChainLink[];
}
```

### `getCapabilities()`

Declare what the adapter supports. The evaluator uses this to skip metrics the adapter cannot perform (scored as `null` / N/A, not penalized).

```typescript
{
  supports_history: boolean;
  supports_temporal_replay: boolean;
  supports_provenance: boolean;
  supports_abstention: boolean;
  supports_source_authority: boolean;
  supports_deduplication: boolean;
  supports_lifecycle: boolean;
  supports_pre_delivery_certification: boolean;
}
```

New capabilities for extended dimensions:
- `supports_source_authority`: system tracks write authority levels (user_stated > agent_extracted)
- `supports_deduplication`: system detects and consolidates near-duplicate entities
- `supports_lifecycle`: system tracks fact lifecycle states (active/superseded/expired)
- `supports_pre_delivery_certification`: system can flag integrity issues before returning results

### `reset()`

Clear all state between scenarios. Each scenario must start from a clean slate.

### `teardown()`

Clean up connections and resources after all scenarios complete.

## Registration

Add your adapter to `src/cli.ts` in the `createAdapter` switch:

```typescript
case "my-system":
  return new MySystemAdapter(url);
```

## Example: Minimal Adapter

```typescript
import type { MemoryAdapter, AdapterCapabilities } from "../adapter.js";
import type { Session, ProbeOptions, ProbeResult, FactHistory, Provenance } from "../types.js";

export class MyAdapter implements MemoryAdapter {
  readonly name = "my-system";

  async init() { /* connect */ }

  async processSession(session: Session) {
    for (const msg of session.messages) {
      if (msg.role === "user") {
        await this.storeMessage(msg.content, session.timestamp);
      }
    }
  }

  async probe(prompt: string, options?: ProbeOptions): Promise<ProbeResult> {
    if (options?.mode === "no_memory") {
      return { answer: "", confidence: null, cited_sources: [], abstained: true };
    }
    const answer = await this.queryMemory(prompt);
    return {
      answer: answer ?? "",
      confidence: answer ? 0.9 : null,
      cited_sources: [],
      abstained: !answer,
    };
  }

  async getHistory(_factId: string): Promise<FactHistory | null> {
    return null; // not supported
  }

  async getStateAsOf(_factId: string, _ts: string): Promise<unknown | null> {
    return null; // not supported
  }

  async getProvenance(_factId: string): Promise<Provenance | null> {
    return null; // not supported
  }

  getCapabilities(): AdapterCapabilities {
    return {
      supports_history: false,
      supports_temporal_replay: false,
      supports_provenance: false,
      supports_abstention: false,
      supports_source_authority: false,
      supports_deduplication: false,
      supports_lifecycle: false,
      supports_pre_delivery_certification: false,
    };
  }

  async reset() { /* clear state */ }
  async teardown() { /* close connections */ }

  private async storeMessage(content: string, timestamp: string) { /* ... */ }
  private async queryMemory(prompt: string): Promise<string | null> { /* ... */ }
}
```

## Included Adapters

| Adapter | File | Capabilities |
|---------|------|-------------|
| `baseline` | `src/adapters/baseline.ts` | None (naive KV store, overwrites on update) |
| `neotoma` | `src/adapters/neotoma.ts` | History, temporal replay, provenance, source authority |
