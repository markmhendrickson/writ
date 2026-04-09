import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import type { BenchmarkReport } from "./types.js";

async function main() {
  const resultsDir = process.argv[2] ?? "results";

  const files = await readdir(resultsDir);
  const jsonFiles = files
    .filter((f) => extname(f) === ".json")
    .sort()
    .reverse();

  if (jsonFiles.length === 0) {
    console.log("No result files found in", resultsDir);
    process.exit(1);
  }

  const latest = jsonFiles[0]!;
  console.log(`Reading: ${latest}\n`);

  const raw = await readFile(join(resultsDir, latest), "utf-8");
  const report = JSON.parse(raw) as BenchmarkReport;

  console.log("# WRIT Benchmark Report");
  console.log(`Adapter: ${report.adapter_name}`);
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Scenarios: ${report.scenarios_run}`);
  console.log();

  console.log("## Aggregate Scores");
  console.log();
  printScoreTable(report);

  if (Object.keys(report.by_category).length > 0) {
    console.log("\n## By Category");
    for (const [cat, scores] of Object.entries(report.by_category)) {
      console.log(`\n### ${cat} (${scores.scenarios_evaluated} scenarios)`);
      console.log(
        `  Recall: ${pct(scores.recall_accuracy)} | Update: ${pct(scores.update_fidelity)} | Drift: ${pct(scores.drift_rate)} | Temporal: ${pct(scores.temporal_accuracy)}`
      );
    }
  }

  if (report.scenario_results.length > 0) {
    console.log("\n## Scenario Details");
    for (const r of report.scenario_results) {
      const status = r.detected_failures.length === 0 ? "PASS" : "FAIL";
      console.log(
        `  [${status}] ${r.scenario_id} (${r.mode})`
      );
      if (r.detected_failures.length > 0) {
        console.log(`    Failures: ${r.detected_failures.join(", ")}`);
      }
      if (r.failure_attribution) {
        console.log(`    Attribution: ${r.failure_attribution}`);
      }
    }
  }
}

function printScoreTable(report: BenchmarkReport) {
  const s = report.aggregate;
  const rows = [
    ["Recall Accuracy", pct(s.recall_accuracy)],
    ["Update Fidelity", pct(s.update_fidelity)],
    ["Drift Rate", pct(s.drift_rate)],
    ["Detectability", pct(s.detectability)],
    ["Temporal Accuracy", pct(s.temporal_accuracy)],
    ["Provenance Completeness", pct(s.provenance_completeness)],
    ["Constraint Consistency", pct(s.constraint_consistency)],
    ["Hallucination Rate", pct(s.hallucination_rate)],
    ["Abstention Quality", pct(s.abstention_quality)],
  ];

  const maxLabel = Math.max(...rows.map((r) => r[0]!.length));
  for (const [label, value] of rows) {
    console.log(`  ${label!.padEnd(maxLabel)}  ${value}`);
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
