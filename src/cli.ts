import { parseArgs } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadAllScenarios, loadScenariosByCategory } from "./loader.js";
import { runBenchmark, WRIT_VERSION } from "./runner.js";
import { generateMarkdownReport } from "./report.js";
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
    "output-format": { type: "string", default: "both" },
    "fail-below-recall": { type: "string" },
    "fail-below-update": { type: "string" },
    "fail-above-hallucination": { type: "string" },
  },
  strict: false,
});

async function main() {
  const adapterName = String(values.adapter ?? "baseline");
  const scenarioFilter = String(values.scenarios ?? "all");
  const modesStr = String(values.modes ?? "native_memory");
  const neotomaUrl = String(values["neotoma-url"] ?? "http://localhost:3080");
  const outputDir = String(values.output ?? "results");
  const outputFormat = String(values["output-format"] ?? "both");

  const adapter = createAdapter(adapterName, neotomaUrl);
  const modes = modesStr.split(",") as EvaluationMode[];

  console.log(`WRIT Benchmark v${WRIT_VERSION}`);
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
  const baseName = `writ-${adapter.name}-${Date.now()}`;

  if (outputFormat === "json" || outputFormat === "both") {
    const jsonPath = join(outputDir, `${baseName}.json`);
    await writeFile(jsonPath, JSON.stringify(report, null, 2));
    console.log(`\nJSON report: ${jsonPath}`);
  }

  if (outputFormat === "markdown" || outputFormat === "both") {
    const md = await generateMarkdownReport(report);
    const mdPath = join(outputDir, `${baseName}.md`);
    await writeFile(mdPath, md);
    console.log(`Markdown report: ${mdPath}`);
  }

  let exitCode = 0;
  const thresholdRecall = parseFloat(
    String(values["fail-below-recall"] ?? "")
  );
  const thresholdUpdate = parseFloat(
    String(values["fail-below-update"] ?? "")
  );
  const thresholdHallucination = parseFloat(
    String(values["fail-above-hallucination"] ?? "")
  );

  if (!isNaN(thresholdRecall) && report.aggregate.recall_accuracy < thresholdRecall) {
    console.error(
      `\nThreshold FAIL: recall_accuracy ${pct(report.aggregate.recall_accuracy)} < ${pct(thresholdRecall)}`
    );
    exitCode = 1;
  }

  if (!isNaN(thresholdUpdate) && report.aggregate.update_fidelity < thresholdUpdate) {
    console.error(
      `\nThreshold FAIL: update_fidelity ${pct(report.aggregate.update_fidelity)} < ${pct(thresholdUpdate)}`
    );
    exitCode = 1;
  }

  if (
    !isNaN(thresholdHallucination) &&
    report.aggregate.hallucination_rate > thresholdHallucination
  ) {
    console.error(
      `\nThreshold FAIL: hallucination_rate ${pct(report.aggregate.hallucination_rate)} > ${pct(thresholdHallucination)}`
    );
    exitCode = 1;
  }

  process.exit(exitCode);
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
