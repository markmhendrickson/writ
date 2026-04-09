import type {
  Session,
  ProbeOptions,
  ProbeResult,
  FactHistory,
  Provenance,
} from "./types.js";

/**
 * Memory system adapter interface.
 *
 * Each adapter wraps a specific memory system (Neotoma, Mem0, a plain
 * key-value store, etc.) and exposes the operations WORKMEM needs to
 * run scenarios and evaluate write-integrity properties.
 */
export interface MemoryAdapter {
  readonly name: string;

  /** Set up any connections, databases, or initial state. */
  init(): Promise<void>;

  /**
   * Feed a conversation session into the memory system.
   * The adapter should store facts, entities, and relationships
   * as the target system would in production.
   */
  processSession(session: Session): Promise<void>;

  /**
   * Send a probe prompt to the memory system and return its response.
   * In oracle mode, the adapter injects ground-truth state instead of
   * relying on the system's own memory.
   */
  probe(prompt: string, options?: ProbeOptions): Promise<ProbeResult>;

  /**
   * Retrieve the full value history for a given fact ID.
   * Returns null if the system does not support history tracking.
   */
  getHistory(factId: string): Promise<FactHistory | null>;

  /**
   * Reconstruct the value of a fact as of a specific timestamp.
   * Returns null if the system does not support temporal queries.
   */
  getStateAsOf(factId: string, timestamp: string): Promise<unknown | null>;

  /**
   * Retrieve provenance metadata for a stored fact.
   * Returns null if the system does not track provenance.
   */
  getProvenance(factId: string): Promise<Provenance | null>;

  /** Reset all state. Called between scenarios. */
  reset(): Promise<void>;

  /** Clean up connections, temporary state. */
  teardown(): Promise<void>;
}

/**
 * Adapter capabilities reported during init.
 * WORKMEM uses these to adjust scoring -- systems that don't claim
 * history support aren't penalized for missing temporal metrics,
 * but their scorecard shows "not supported" rather than a number.
 */
export interface AdapterCapabilities {
  supports_history: boolean;
  supports_temporal_replay: boolean;
  supports_provenance: boolean;
  supports_abstention: boolean;
}
