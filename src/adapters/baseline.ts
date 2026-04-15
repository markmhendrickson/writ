import type { MemoryAdapter, AdapterCapabilities } from "../adapter.js";
import type {
  Session,
  ProbeOptions,
  ProbeResult,
  FactHistory,
  Provenance,
} from "../types.js";

/**
 * Baseline adapter: naive mutable key-value store.
 *
 * Overwrites values on update. No history, no provenance, no temporal
 * replay. This is the default behavior of most memory systems --
 * it should score well on retrieval and poorly on everything else.
 */
export class BaselineAdapter implements MemoryAdapter {
  readonly name = "baseline";
  private store = new Map<string, unknown>();

  async init(): Promise<void> {
    this.store.clear();
  }

  async processSession(session: Session): Promise<void> {
    for (const msg of session.messages) {
      if (msg.role !== "user") continue;
      const facts = this.extractFacts(msg.content);
      for (const [key, value] of facts) {
        this.store.set(key, value);
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
      const relevant = this.findRelevant(prompt, options.oracle_state);
      return {
        answer: relevant ?? "",
        confidence: relevant ? 1.0 : null,
        cited_sources: [],
        abstained: !relevant,
      };
    }

    const relevant = this.findRelevantFromStore(prompt);
    return {
      answer: relevant ?? "",
      confidence: relevant ? 0.8 : null,
      cited_sources: [],
      abstained: !relevant,
    };
  }

  async getHistory(_factId: string): Promise<FactHistory | null> {
    return null;
  }

  async getStateAsOf(
    _factId: string,
    _timestamp: string
  ): Promise<unknown | null> {
    return null;
  }

  async getProvenance(_factId: string): Promise<Provenance | null> {
    return null;
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

  async reset(): Promise<void> {
    this.store.clear();
  }

  async teardown(): Promise<void> {
    this.store.clear();
  }

  private extractFacts(content: string): [string, unknown][] {
    const facts: [string, unknown][] = [];

    const kvPattern = /my (\w+) is (.+)/gi;
    let match;
    while ((match = kvPattern.exec(content)) !== null) {
      if (match[1] && match[2]) {
        facts.push([match[1].toLowerCase(), match[2].trim()]);
      }
    }

    const verbPatterns = [
      { pattern: /I (?:work|am working) at (.+?)(?:\.|,|$)/gi, key: "work" },
      { pattern: /I (?:live|moved) (?:in|to) (.+?)(?:\.|,|$)/gi, key: "location" },
    ];
    for (const { pattern, key } of verbPatterns) {
      let m;
      while ((m = pattern.exec(content)) !== null) {
        if (m[1]) facts.push([key, m[1].trim()]);
      }
    }

    return facts;
  }

  private findRelevantFromStore(prompt: string): string | null {
    const lower = prompt.toLowerCase();
    for (const [key, value] of this.store) {
      if (lower.includes(key)) {
        return String(value);
      }
    }
    return null;
  }

  private findRelevant(
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
