import type { MemoryAdapter } from "./adapter.js";
import type {
  Scenario,
  ScenarioResult,
  EvaluationMode,
  BenchmarkReport,
  ScenarioCategory,
  AggregateScores,
} from "./types.js";
import { evaluateScenario, aggregateScores } from "./evaluator.js";

export interface RunOptions {
  scenarios: Scenario[];
  adapter: MemoryAdapter;
  modes?: EvaluationMode[];
  categories?: ScenarioCategory[];
  onScenarioComplete?: (result: ScenarioResult) => void;
}

export async function runBenchmark(
  options: RunOptions
): Promise<BenchmarkReport> {
  const {
    scenarios,
    adapter,
    modes = ["native_memory"],
    categories,
    onScenarioComplete,
  } = options;

  let filtered = scenarios;
  if (categories?.length) {
    filtered = scenarios.filter((s) => categories.includes(s.category));
  }

  await adapter.init();

  const results: ScenarioResult[] = [];

  for (const scenario of filtered) {
    for (const mode of modes) {
      await adapter.reset();

      const result = await evaluateScenario(scenario, adapter, mode);
      results.push(result);

      onScenarioComplete?.(result);
    }
  }

  await adapter.teardown();

  const aggregate = aggregateScores(results);

  const byCategory = groupByCategory(results);
  const byMode = groupByMode(results);

  return {
    adapter_name: adapter.name,
    timestamp: new Date().toISOString(),
    scenarios_run: filtered.length,
    aggregate,
    by_category: byCategory,
    by_mode: byMode,
    scenario_results: results,
  };
}

function groupByCategory(
  results: ScenarioResult[]
): Record<ScenarioCategory, AggregateScores> {
  const groups: Partial<Record<ScenarioCategory, ScenarioResult[]>> = {};

  for (const r of results) {
    const cat = r.scenario_id.split("-")[0] as ScenarioCategory;
    if (!groups[cat]) groups[cat] = [];
    groups[cat]!.push(r);
  }

  const out: Record<string, AggregateScores> = {};
  for (const [cat, items] of Object.entries(groups)) {
    out[cat] = aggregateScores(items!);
  }

  return out as Record<ScenarioCategory, AggregateScores>;
}

function groupByMode(
  results: ScenarioResult[]
): Record<EvaluationMode, AggregateScores> {
  const groups: Partial<Record<EvaluationMode, ScenarioResult[]>> = {};

  for (const r of results) {
    if (!groups[r.mode]) groups[r.mode] = [];
    groups[r.mode]!.push(r);
  }

  const out: Record<string, AggregateScores> = {};
  for (const [mode, items] of Object.entries(groups)) {
    out[mode] = aggregateScores(items!);
  }

  return out as Record<EvaluationMode, AggregateScores>;
}
