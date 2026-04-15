import type { MemoryAdapter, AdapterCapabilities } from "../adapter.js";
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
 * Neotoma adapter for WRIT.
 *
 * Tests Neotoma's observation-based memory model:
 * - Immutable observations (append-only, no overwrites)
 * - Entity state derived from full observation history
 * - Temporal replay via observation timestamps
 * - Provenance chain from observation -> source -> session
 *
 * Requires a running Neotoma instance (HTTP API).
 */
export class NeotomaAdapter implements MemoryAdapter {
  readonly name = "neotoma";
  private baseUrl: string;
  private token: string | undefined;
  private userId: string | undefined;
  private factToEntity = new Map<string, string>();
  private runId: string;

  constructor(
    baseUrl = "http://localhost:3080",
    options?: { token?: string; userId?: string }
  ) {
    this.baseUrl = baseUrl;
    this.token = options?.token ?? process.env.WRIT_NEOTOMA_TOKEN;
    this.userId = options?.userId ?? process.env.WRIT_NEOTOMA_USER_ID;
    this.runId = `writ-${Date.now()}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(
        `Neotoma not reachable at ${this.baseUrl}: ${res.status}`
      );
    }
    this.factToEntity.clear();
    this.runId = `writ-${Date.now()}`;
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
      headers: this.headers(),
      body: JSON.stringify({
        entities,
        idempotency_key: `${this.runId}-session-${session.session_id}`,
        ...(this.userId ? { user_id: this.userId } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Neotoma store failed: ${res.status} ${await res.text()}`
      );
    }

    const data = (await res.json()) as {
      structured?: {
        entities?: { entity_id: string; entity_type: string }[];
      };
      entities?: { entity_id: string; entity_type: string }[];
    };

    const returned = data.structured?.entities ?? data.entities ?? [];
    for (let i = 0; i < returned.length && i < entities.length; i++) {
      const factId = entities[i]?.writ_fact_id as string | undefined;
      if (factId && returned[i]) {
        this.factToEntity.set(factId, returned[i]!.entity_id);
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

    const searchRes = await fetch(`${this.baseUrl}/entities/query`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        search: prompt,
        limit: 5,
        ...(this.userId ? { user_id: this.userId } : {}),
      }),
    });

    if (!searchRes.ok) {
      return {
        answer: "",
        confidence: null,
        cited_sources: [],
        abstained: true,
      };
    }

    const searchData = (await searchRes.json()) as {
      entities?: {
        entity_id: string;
        snapshot?: Record<string, unknown>;
        canonical_name?: string;
      }[];
    };
    const entities = searchData.entities ?? [];

    if (entities.length === 0) {
      return {
        answer: "",
        confidence: null,
        cited_sources: [],
        abstained: true,
      };
    }

    const parts: string[] = [];
    const sources: string[] = [];
    for (const entity of entities) {
      sources.push(entity.entity_id);
      const snapshot = entity.snapshot ?? {};
      const vals = Object.entries(snapshot)
        .filter(
          ([k, v]) =>
            typeof v === "string" &&
            !k.startsWith("writ_") &&
            k !== "entity_type"
        )
        .map(([, v]) => v as string);
      if (vals.length > 0) parts.push(vals.join(", "));
    }

    const answer = parts.join("; ");
    return {
      answer,
      confidence: answer ? 0.9 : null,
      cited_sources: sources,
      abstained: !answer,
    };
  }

  async getHistory(factId: string): Promise<FactHistory | null> {
    const entityId = this.factToEntity.get(factId) ?? factId;

    const res = await fetch(
      `${this.baseUrl}/entities/${entityId}/observations`,
      { headers: this.headers() }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      observations?: {
        id: string;
        observed_at: string;
        fields: Record<string, unknown>;
      }[];
    };
    const observations = data.observations ?? [];

    if (observations.length === 0) return null;

    const values: ValueHistoryEntry[] = observations.map((obs) => ({
      value: obs.fields,
      as_of: obs.observed_at,
      source_session: Number(obs.fields?.writ_session ?? 0),
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
    const entityId = this.factToEntity.get(factId) ?? factId;

    const res = await fetch(`${this.baseUrl}/get_field_provenance`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        entity_id: entityId,
        field: "content",
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        observations?: {
          id: string;
          observed_at: string;
          source_id?: string;
          fields?: Record<string, unknown>;
        }[];
        sources?: { id: string; original_filename?: string }[];
      };
      const observations = data.observations ?? [];

      if (observations.length > 0) {
        const chain: ProvenanceChainLink[] = observations.map((obs, i) => ({
          timestamp: obs.observed_at,
          action: i === 0 ? ("created" as const) : ("updated" as const),
          session: Number(obs.fields?.writ_session ?? 0),
          value: obs.fields,
        }));

        const firstObs = observations[0]!;
        return {
          fact_id: factId,
          source_session: Number(firstObs.fields?.writ_session ?? 0),
          source_message_index: Number(
            firstObs.fields?.writ_message_index ?? 0
          ),
          agent_or_user: "user",
          chain,
        };
      }
    }

    const obsRes = await fetch(
      `${this.baseUrl}/entities/${entityId}/observations`,
      { headers: this.headers() }
    );

    if (!obsRes.ok) return null;

    const obsData = (await obsRes.json()) as {
      observations?: {
        id: string;
        observed_at: string;
        source_id?: string;
        fields: Record<string, unknown>;
      }[];
    };
    const observations = obsData.observations ?? [];

    if (observations.length === 0) return null;

    const chain: ProvenanceChainLink[] = observations.map((obs, i) => ({
      timestamp: obs.observed_at,
      action: i === 0 ? ("created" as const) : ("updated" as const),
      session: Number(obs.fields?.writ_session ?? 0),
      value: obs.fields,
    }));

    const firstObs = observations[0]!;
    return {
      fact_id: factId,
      source_session: Number(firstObs.fields?.writ_session ?? 0),
      source_message_index: Number(
        firstObs.fields?.writ_message_index ?? 0
      ),
      agent_or_user: "user",
      chain,
    };
  }

  getCapabilities(): AdapterCapabilities {
    return {
      supports_history: true,
      supports_temporal_replay: true,
      supports_provenance: true,
      supports_abstention: false,
      supports_source_authority: true,
      supports_deduplication: false,
      supports_lifecycle: false,
      supports_pre_delivery_certification: false,
    };
  }

  async reset(): Promise<void> {
    this.factToEntity.clear();
    this.runId = `writ-${Date.now()}`;
  }

  async teardown(): Promise<void> {
    this.factToEntity.clear();
  }

  private extractEntities(
    content: string,
    session: Session
  ): Record<string, unknown>[] {
    const entities: Record<string, unknown>[] = [];
    const base = {
      writ_run_id: this.runId,
      writ_session: session.session_id,
      writ_timestamp: session.timestamp,
    };

    const emailMatch = content.match(
      /(?:my )?email\s+(?:is\s+)?(\S+@\S+)/i
    );
    if (emailMatch) {
      entities.push({
        entity_type: "contact",
        email: emailMatch[1],
        writ_fact_id: "email",
        ...base,
      });
    }

    const workMatch = content.match(
      /I (?:work|am working|just accepted.*?role.*?work) at (.+?)(?:\.|,|$)/i
    );
    if (workMatch) {
      entities.push({
        entity_type: "employment",
        company: workMatch[1]!.trim(),
        writ_fact_id: "employer",
        ...base,
      });
    }

    const liveMatch = content.match(
      /I (?:live|moved|am living) (?:in|to) (.+?)(?:\.|,|$)/i
    );
    if (liveMatch) {
      entities.push({
        entity_type: "location",
        place: liveMatch[1]!.trim(),
        writ_fact_id: "location",
        ...base,
      });
    }

    const nameMatch = content.match(
      /(?:my name is|I'm|I am) ([A-Z][a-z]+ [A-Z][a-z]+)/
    );
    if (nameMatch) {
      entities.push({
        entity_type: "person",
        name: nameMatch[1]!.trim(),
        writ_fact_id: "name",
        ...base,
      });
    }

    if (entities.length === 0) {
      entities.push({
        entity_type: "writ_fact",
        content,
        writ_fact_id: `fact-${session.session_id}`,
        ...base,
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
