import { parseArgs } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadAllScenarios, loadScenariosByCategory } from "./loader.js";
import { runBenchmark } from "./runner.js";
import { BaselineAdapter } from "./adapters/baseline.js";
import { NeotomaAdapter } from "./adapters/neotoma.js";
import type { MemoryAdapter } from "./adapter.js";
import type { ScenarioCategory, EvaluationMode } from "./types.js";

const { values } = parseArgs({
  options: {
    adapter: { type: "string", default: "baseline" },
    scenarios: { type: "string", default: "all" },
    modes: { type: "string", default: "native_memory" },
    "neotoma-url": { type: "string", default: "http://localhost:3080" },
    output: { type: "string", default: "results" },
  },
  strict: false,
});

async function main() {
  const adapterName = String(values.adapter ?? "baseline");
  const scenarioFilter = String(values.scenarios ?? "all");
  const modesStr = String(values.modes ?? "native_memory");
  const neotomaUrl = String(values["neotoma-url"] ?? "http://localhost:3080");
  const outputDir = String(values.output ?? "results");

  const adapter = createAdapter(adapterName, neotomaUrl);
  const modes = modesStr.split(",") as EvaluationMode[];

  console.log(`WORKMEM Benchmark`);
  console.log(`Adapter: ${adapter.name}`);
  console.log(`Modes: ${modes.join(", ")}`);
  console.log(`Scenarios: ${scenarioFilter}`);
  console.log("---");

  const scenarios =
    scenarioFilter === "all"
      ? await loadAllScenarios()
      : await loadScenariosByCategory(scenarioFilter as ScenarioCategory);

  if (scenarios.length === 0) {
    console.log("No scenarios found.");
    process.exit(1);
  }

  console.log(`Loaded ${scenarios.length} scenarios\n`);

  const report = await runBenchmark({
    scenarios,
    adapter,
    modes,
    onScenarioComplete: (result) => {
      const status = result.detected_failures.length === 0 ? "PASS" : "FAIL";
      const failures = result.detected_failures.join(", ") || "none";
      console.log(
        `  [${status}] ${result.scenario_id} (${result.mode}) — failures: ${failures}`
      );
    },
  });

  console.log("\n--- Aggregate Scores ---");
  console.log(`Recall Accuracy:         ${pct(report.aggregate.recall_accuracy)}`);
  console.log(`Update Fidelity:         ${pct(report.aggregate.update_fidelity)}`);
  console.log(`Drift Rate:              ${pct(report.aggregate.drift_rate)}`);
  console.log(`Detectability:           ${pct(report.aggregate.detectability)}`);
  console.log(`Temporal Accuracy:       ${pct(report.aggregate.temporal_accuracy)}`);
  console.log(`Provenance Completeness: ${pct(report.aggregate.provenance_completeness)}`);
  console.log(`Constraint Consistency:  ${pct(report.aggregate.constraint_consistency)}`);
  console.log(`Hallucination Rate:      ${pct(report.aggregate.hallucination_rate)}`);
  console.log(`Abstention Quality:      ${pct(report.aggregate.abstention_quality)}`);

  await mkdir(outputDir, { recursive: true });
  const reportPath = join(
    outputDir,
    `workmem-${adapter.name}-${Date.now()}.json`
  );
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${reportPath}`);
}

function createAdapter(name: string, neotomaUrl: string): MemoryAdapter {
  switch (name) {
    case "neotoma":
      return new NeotomaAdapter(neotomaUrl);
    case "baseline":
      return new BaselineAdapter();
    default:
      console.error(`Unknown adapter: ${name}`);
      process.exit(1);
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
