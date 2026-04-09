import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type {
  BenchmarkReport,
  AggregateScores,
  ScenarioResult,
} from "./types.js";

export async function generateMarkdownReport(
  report: BenchmarkReport
): Promise<string> {
  const lines: string[] = [];

  lines.push("# WRIT Benchmark Report");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Adapter | ${report.adapter_name} |`);
  lines.push(`| WRIT Version | ${report.writ_version} |`);
  lines.push(`| Timestamp | ${report.timestamp} |`);
  lines.push(`| Scenarios | ${report.scenarios_run} |`);
  lines.push("");

  lines.push("## Aggregate Scores");
  lines.push("");
  lines.push(formatScoreTable(report.aggregate));

  if (Object.keys(report.by_mode).length > 1) {
    lines.push("");
    lines.push("## Scores by Mode");
    lines.push("");
    lines.push(formatModeComparison(report));
  }

  if (Object.keys(report.by_category).length > 0) {
    lines.push("");
    lines.push("## Scores by Category");
    lines.push("");
    lines.push(formatCategoryTable(report));
  }

  const failureDist = computeFailureDistribution(report);
  if (failureDist.length > 0) {
    lines.push("");
    lines.push("## Failure Mode Distribution");
    lines.push("");
    lines.push("| Failure Mode | Count | % of Scenarios |");
    lines.push("|-------------|-------|----------------|");
    for (const [mode, count] of failureDist) {
      const pct = ((count / report.scenario_results.length) * 100).toFixed(1);
      lines.push(`| ${mode} | ${count} | ${pct}% |`);
    }
  }

  const attrDist = computeAttributionDistribution(report);
  if (attrDist.length > 0) {
    lines.push("");
    lines.push("## Failure Attribution");
    lines.push("");
    lines.push("| Layer | Count |");
    lines.push("|-------|-------|");
    for (const [layer, count] of attrDist) {
      lines.push(`| ${layer} | ${count} |`);
    }
  }

  lines.push("");
  lines.push("## Scenario Details");
  lines.push("");

  const grouped: Record<string, ScenarioResult[]> = {};
  for (const r of report.scenario_results) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category]!.push(r);
  }

  for (const [cat, results] of Object.entries(grouped).sort()) {
    lines.push(`### ${cat}`);
    lines.push("");
    lines.push("| Scenario | Mode | Recall | Update | Temporal | Provenance | Constraint | Failures |");
    lines.push("|----------|------|--------|--------|----------|------------|------------|----------|");
    for (const r of results) {
      const recall = r.scores.recall_correct ? "PASS" : "FAIL";
      const update = r.scores.update_fidelity === null ? "N/A" : r.scores.update_fidelity ? "PASS" : "FAIL";
      const temporal = r.scores.temporal_correct === null ? "N/A" : r.scores.temporal_correct ? "PASS" : "FAIL";
      const prov = r.scores.provenance_complete === null ? "N/A" : r.scores.provenance_complete ? "PASS" : "FAIL";
      const constraint = r.scores.constraint_respected === null ? "N/A" : r.scores.constraint_respected ? "PASS" : "FAIL";
      const failures = r.detected_failures.length > 0
        ? r.detected_failures.join(", ")
        : "none";
      lines.push(
        `| ${r.scenario_id} | ${r.mode} | ${recall} | ${update} | ${temporal} | ${prov} | ${constraint} | ${failures} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatScoreTable(scores: AggregateScores): string {
  const rows = [
    ["Metric", "Score"],
    ["---", "---"],
    ["Recall Accuracy", pct(scores.recall_accuracy)],
    ["Update Fidelity", pct(scores.update_fidelity)],
    ["Drift Rate", pct(scores.drift_rate)],
    ["Detectability", pct(scores.detectability)],
    ["Temporal Accuracy", pct(scores.temporal_accuracy)],
    ["Provenance Completeness", pct(scores.provenance_completeness)],
    ["Constraint Consistency", pct(scores.constraint_consistency)],
    ["Hallucination Rate", pct(scores.hallucination_rate)],
    ["Abstention Quality", pct(scores.abstention_quality)],
    ["Scenarios Evaluated", String(scores.scenarios_evaluated)],
  ];
  return rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function formatModeComparison(report: BenchmarkReport): string {
  const modes = Object.keys(report.by_mode).sort();
  const metrics: (keyof AggregateScores)[] = [
    "recall_accuracy",
    "update_fidelity",
    "hallucination_rate",
    "abstention_quality",
  ];

  const header = ["Metric", ...modes];
  const rows = [
    header,
    header.map(() => "---"),
    ...metrics.map((m) => [
      m.replace(/_/g, " "),
      ...modes.map((mode) => pct(report.by_mode[mode as keyof typeof report.by_mode]?.[m] as number ?? 0)),
    ]),
  ];
  return rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function formatCategoryTable(report: BenchmarkReport): string {
  const cats = Object.keys(report.by_category).sort();
  const header = ["Category", "Scenarios", "Recall", "Update", "Drift", "Temporal", "Provenance", "Constraint", "Halluc.", "Abstention"];
  const rows = [
    header,
    header.map(() => "---"),
    ...cats.map((cat) => {
      const s = report.by_category[cat as keyof typeof report.by_category]!;
      return [
        cat,
        String(s.scenarios_evaluated),
        pct(s.recall_accuracy),
        pct(s.update_fidelity),
        pct(s.drift_rate),
        pct(s.temporal_accuracy),
        pct(s.provenance_completeness),
        pct(s.constraint_consistency),
        pct(s.hallucination_rate),
        pct(s.abstention_quality),
      ];
    }),
  ];
  return rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function computeFailureDistribution(
  report: BenchmarkReport
): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of report.scenario_results) {
    for (const f of r.detected_failures) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function computeAttributionDistribution(
  report: BenchmarkReport
): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of report.scenario_results) {
    if (r.failure_attribution) {
      counts.set(
        r.failure_attribution,
        (counts.get(r.failure_attribution) ?? 0) + 1
      );
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

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
  const raw = await readFile(join(resultsDir, latest), "utf-8");
  const report = JSON.parse(raw) as BenchmarkReport;

  const format = process.argv[3] ?? "markdown";

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const md = await generateMarkdownReport(report);
    console.log(md);

    const mdPath = join(resultsDir, latest.replace(".json", ".md"));
    await writeFile(mdPath, md);
    console.error(`\nMarkdown report written to ${mdPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
