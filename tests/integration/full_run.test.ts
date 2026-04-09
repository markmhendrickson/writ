import { describe, it, expect } from "vitest";
import { runBenchmark } from "../../src/runner.js";
import { loadAllScenarios, loadScenariosByCategory } from "../../src/loader.js";
import { BaselineAdapter } from "../../src/adapters/baseline.js";
import type { BenchmarkReport } from "../../src/types.js";

describe("full benchmark run", () => {
  it("runs all scenarios with baseline adapter and produces a valid report", async () => {
    const scenarios = await loadAllScenarios();
    const adapter = new BaselineAdapter();

    const report = await runBenchmark({
      scenarios,
      adapter,
      modes: ["native_memory"],
    });

    expect(report.writ_version).toBeTruthy();
    expect(report.adapter_name).toBe("baseline");
    expect(report.scenarios_run).toBe(scenarios.length);
    expect(report.scenario_results.length).toBe(scenarios.length);
    expect(report.aggregate.scenarios_evaluated).toBe(scenarios.length);

    for (const r of report.scenario_results) {
      expect(r.scenario_id).toBeTruthy();
      expect(r.category).toBeTruthy();
      expect(r.mode).toBe("native_memory");
      expect(r.scores).toBeDefined();
    }

    expect(Object.keys(report.by_category).length).toBeGreaterThan(0);
    expect(Object.keys(report.by_mode).length).toBe(1);
  });

  it("runs all three modes for a single category", async () => {
    const scenarios = await loadScenariosByCategory("drift");
    const adapter = new BaselineAdapter();

    const report = await runBenchmark({
      scenarios,
      adapter,
      modes: ["no_memory", "native_memory", "oracle_memory"],
    });

    expect(report.scenarios_run).toBe(scenarios.length);
    expect(report.scenario_results.length).toBe(scenarios.length * 3);

    const modes = new Set(report.scenario_results.map((r) => r.mode));
    expect(modes.has("no_memory")).toBe(true);
    expect(modes.has("native_memory")).toBe(true);
    expect(modes.has("oracle_memory")).toBe(true);

    expect(Object.keys(report.by_mode).length).toBe(3);
  });

  it("baseline adapter fails on history/temporal/provenance metrics", async () => {
    const scenarios = await loadScenariosByCategory("drift");
    const adapter = new BaselineAdapter();

    const report = await runBenchmark({
      scenarios,
      adapter,
      modes: ["native_memory"],
    });

    expect(report.aggregate.detectability).toBe(0);
    expect(report.aggregate.temporal_accuracy).toBe(0);
    expect(report.aggregate.provenance_completeness).toBe(0);
  });

  it("produces valid report JSON structure", async () => {
    const scenarios = await loadScenariosByCategory("drift");
    const adapter = new BaselineAdapter();

    const report = await runBenchmark({
      scenarios,
      adapter,
      modes: ["native_memory"],
    });

    const json = JSON.stringify(report);
    const parsed = JSON.parse(json) as BenchmarkReport;

    expect(parsed.writ_version).toBe(report.writ_version);
    expect(parsed.adapter_name).toBe(report.adapter_name);
    expect(parsed.scenario_results.length).toBe(report.scenario_results.length);
  });
});
