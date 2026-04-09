export type MemoryEventType =
  | "explicit"
  | "mutable"
  | "latent"
  | "entity"
  | "work_state"
  | "non_memory";

export type ScenarioCategory =
  | "drift"
  | "temporal"
  | "provenance"
  | "constraint"
  | "entity"
  | "forgetting"
  | "update"
  | "multi_hop";

export type RequiredCapability =
  | "retrieval"
  | "update_tracking"
  | "history_preservation"
  | "temporal_replay"
  | "provenance_tracing"
  | "constraint_application"
  | "multi_hop"
  | "selective_forgetting"
  | "abstention";

export type FailureMode =
  | "stale_memory"
  | "missing_memory"
  | "incorrect_generalization"
  | "memory_hallucination"
  | "constraint_violation"
  | "retrieval_miss"
  | "over_retention"
  | "false_confidence"
  | "silent_drift"
  | "provenance_loss";

export type EvaluationMode = "no_memory" | "native_memory" | "oracle_memory";

export type AttributionLayer = "state" | "retrieval" | "agent_policy";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  session_id: number;
  timestamp: string;
  messages: Message[];
}

export interface ValueHistoryEntry {
  value: unknown;
  as_of: string;
  source_session: number;
}

export interface MemoryEvent {
  id: string;
  type: MemoryEventType;
  value: unknown;
  introduced_in: number;
  updated_in: number | null;
  retracted_in: number | null;
  should_persist: boolean;
  previous_values: ValueHistoryEntry[];
}

export interface TemporalQuery {
  as_of: string | null;
  expect_current: boolean;
}

export interface Probe {
  session: number;
  prompt: string;
  required_capabilities: RequiredCapability[];
  temporal_query?: TemporalQuery;
  should_abstain: boolean;
}

export interface ProvenanceInfo {
  source_session: number;
  source_message_index: number;
  agent_or_user: "user" | "assistant" | "system";
}

export interface GroundTruth {
  current_value: unknown;
  value_history: ValueHistoryEntry[];
  provenance: ProvenanceInfo;
}

export interface Scenario {
  scenario_id: string;
  version: string;
  category: ScenarioCategory;
  description: string;
  sessions: Session[];
  memory_events: MemoryEvent[];
  probe: Probe;
  ground_truth: GroundTruth;
  failure_modes: FailureMode[];
}

export interface ProbeOptions {
  mode: EvaluationMode;
  oracle_state?: Record<string, unknown>;
}

export interface ProbeResult {
  answer: string;
  confidence: number | null;
  cited_sources: string[];
  abstained: boolean;
  raw_response?: unknown;
}

export interface FactHistory {
  fact_id: string;
  values: ValueHistoryEntry[];
  current_value: unknown;
}

export interface Provenance {
  fact_id: string;
  source_session: number;
  source_message_index: number;
  agent_or_user: string;
  chain: ProvenanceChainLink[];
}

export interface ProvenanceChainLink {
  timestamp: string;
  action: "created" | "updated" | "retracted";
  session: number;
  value: unknown;
}

export interface ScenarioResult {
  scenario_id: string;
  mode: EvaluationMode;
  probe_result: ProbeResult;
  scores: ScenarioScores;
  failure_attribution: AttributionLayer | null;
  detected_failures: FailureMode[];
}

export interface ScenarioScores {
  recall_correct: boolean;
  update_fidelity: boolean | null;
  drift_detected: boolean | null;
  temporal_correct: boolean | null;
  provenance_complete: boolean | null;
  constraint_respected: boolean | null;
  abstention_correct: boolean | null;
  hallucination_detected: boolean;
}

export interface BenchmarkReport {
  adapter_name: string;
  timestamp: string;
  scenarios_run: number;
  aggregate: AggregateScores;
  by_category: Record<ScenarioCategory, AggregateScores>;
  by_mode: Record<EvaluationMode, AggregateScores>;
  scenario_results: ScenarioResult[];
}

export interface AggregateScores {
  recall_accuracy: number;
  update_fidelity: number;
  drift_rate: number;
  detectability: number;
  temporal_accuracy: number;
  provenance_completeness: number;
  constraint_consistency: number;
  hallucination_rate: number;
  abstention_quality: number;
  scenarios_evaluated: number;
}
