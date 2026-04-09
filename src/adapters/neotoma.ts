import type { MemoryAdapter } from "../adapter.js";
import type {
  Session,
  ProbeOptions,
  ProbeResult,
  FactHistory,
  Provenance,
  ValueHistoryEntry,
  ProvenanceChainLink,
} from "../types.js";

/**
 * Neotoma adapter for WORKMEM.
 *
 * Tests Neotoma's observation-based memory model:
 * - Immutable observations (append-only, no overwrites)
 * - Entity state derived from full observation history
 * - Temporal replay via observation timestamps
 * - Provenance chain from observation -> source -> session
 *
 * Requires a running Neotoma instance (MCP or HTTP API).
 */
export class NeotomaAdapter implements MemoryAdapter {
  readonly name = "neotoma";
  private baseUrl: string;
  private entityMap = new Map<string, string>();

  constructor(baseUrl = "http://localhost:3080") {
    this.baseUrl = baseUrl;
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(
        `Neotoma not reachable at ${this.baseUrl}: ${res.status}`
      );
    }
    this.entityMap.clear();
  }

  async processSession(session: Session): Promise<void> {
    const entities: Record<string, unknown>[] = [];

    for (const msg of session.messages) {
      if (msg.role !== "user") continue;

      const extracted = this.extractEntities(msg.content, session);
      entities.push(...extracted);
    }

    if (entities.length === 0) return;

    const res = await fetch(`${this.baseUrl}/store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entities,
        idempotency_key: `workmem-session-${session.session_id}-${Date.now()}`,
      }),
    });

    if (!res.ok) {
      throw new Error(`Neotoma store failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      entities?: { entity_id: string; entity_type: string }[];
    };
    if (data.entities) {
      for (const ent of data.entities) {
        this.entityMap.set(ent.entity_type, ent.entity_id);
      }
    }
  }

  async probe(prompt: string, options?: ProbeOptions): Promise<ProbeResult> {
    if (options?.mode === "no_memory") {
      return {
        answer: "",
        confidence: null,
        cited_sources: [],
        abstained: true,
      };
    }

    if (options?.mode === "oracle_memory" && options.oracle_state) {
      const answer = this.resolveFromOracle(prompt, options.oracle_state);
      return {
        answer: answer ?? "",
        confidence: answer ? 1.0 : null,
        cited_sources: [],
        abstained: !answer,
      };
    }

    const searchRes = await fetch(
      `${this.baseUrl}/entities/search?` +
        new URLSearchParams({ query: prompt, limit: "5" })
    );

    if (!searchRes.ok) {
      return { answer: "", confidence: null, cited_sources: [], abstained: true };
    }

    const searchData = (await searchRes.json()) as {
      entities?: { entity_id: string; snapshot?: Record<string, unknown> }[];
    };
    const entities = searchData.entities ?? [];

    if (entities.length === 0) {
      return { answer: "", confidence: null, cited_sources: [], abstained: true };
    }

    const topEntity = entities[0]!;
    const snapshot = topEntity.snapshot ?? {};
    const answer = Object.values(snapshot)
      .filter((v) => typeof v === "string")
      .join("; ");

    return {
      answer,
      confidence: 0.9,
      cited_sources: [topEntity.entity_id],
      abstained: false,
    };
  }

  async getHistory(factId: string): Promise<FactHistory | null> {
    const entityId = this.entityMap.get(factId) ?? factId;

    const res = await fetch(
      `${this.baseUrl}/entities/${entityId}/observations`
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      observations?: {
        observation_id: string;
        observed_at: string;
        fields: Record<string, unknown>;
      }[];
    };
    const observations = data.observations ?? [];

    if (observations.length === 0) return null;

    const values: ValueHistoryEntry[] = observations.map((obs) => ({
      value: obs.fields,
      as_of: obs.observed_at,
      source_session: 0,
    }));

    return {
      fact_id: factId,
      values,
      current_value: values[values.length - 1]?.value,
    };
  }

  async getStateAsOf(
    factId: string,
    timestamp: string
  ): Promise<unknown | null> {
    const history = await this.getHistory(factId);
    if (!history) return null;

    const asOf = new Date(timestamp).getTime();
    let result: unknown = null;

    for (const entry of history.values) {
      if (new Date(entry.as_of).getTime() <= asOf) {
        result = entry.value;
      }
    }

    return result;
  }

  async getProvenance(factId: string): Promise<Provenance | null> {
    const entityId = this.entityMap.get(factId) ?? factId;

    const res = await fetch(
      `${this.baseUrl}/entities/${entityId}/observations`
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      observations?: {
        observation_id: string;
        observed_at: string;
        source_id?: string;
        fields: Record<string, unknown>;
      }[];
    };
    const observations = data.observations ?? [];

    if (observations.length === 0) return null;

    const chain: ProvenanceChainLink[] = observations.map((obs, i) => ({
      timestamp: obs.observed_at,
      action: i === 0 ? ("created" as const) : ("updated" as const),
      session: 0,
      value: obs.fields,
    }));

    return {
      fact_id: factId,
      source_session: 0,
      source_message_index: 0,
      agent_or_user: "user",
      chain,
    };
  }

  async reset(): Promise<void> {
    this.entityMap.clear();
  }

  async teardown(): Promise<void> {
    this.entityMap.clear();
  }

  private extractEntities(
    content: string,
    session: Session
  ): Record<string, unknown>[] {
    const entities: Record<string, unknown>[] = [];

    const emailMatch = content.match(
      /(?:my )?email\s+(?:is\s+)?(\S+@\S+)/i
    );
    if (emailMatch) {
      entities.push({
        entity_type: "contact",
        email: emailMatch[1],
        workmem_session: session.session_id,
        workmem_timestamp: session.timestamp,
      });
    }

    const workMatch = content.match(/I (?:work|am working) at (.+?)(?:\.|$)/i);
    if (workMatch) {
      entities.push({
        entity_type: "employment",
        company: workMatch[1]!.trim(),
        workmem_session: session.session_id,
        workmem_timestamp: session.timestamp,
      });
    }

    const liveMatch = content.match(/I (?:live|moved) (?:in|to) (.+?)(?:\.|$)/i);
    if (liveMatch) {
      entities.push({
        entity_type: "location",
        place: liveMatch[1]!.trim(),
        workmem_session: session.session_id,
        workmem_timestamp: session.timestamp,
      });
    }

    if (entities.length === 0) {
      entities.push({
        entity_type: "workmem_fact",
        content,
        workmem_session: session.session_id,
        workmem_timestamp: session.timestamp,
      });
    }

    return entities;
  }

  private resolveFromOracle(
    prompt: string,
    state: Record<string, unknown>
  ): string | null {
    const lower = prompt.toLowerCase();
    for (const [key, value] of Object.entries(state)) {
      if (lower.includes(key.toLowerCase())) {
        return String(value);
      }
    }
    return null;
  }
}
