## Summary
WRIT now benchmarks the failure modes that actually break long-lived AI memory in production: source-authority overwrites, extraction drift, system-level write failures, fact lifecycle transitions, and pre-delivery integrity checks.

## Why This Release Exists
This release expands WRIT in direct response to failure modes surfaced in the r/AIMemory discussion "No AI memory benchmark tests what actually breaks." That discussion highlighted five recurring gaps in real-world memory systems: lower-authority writes overwriting user-stated facts, extraction drift creating near-duplicate records, flush/restart failures corrupting state, facts lacking explicit superseded/expired lifecycle handling, and systems returning stale or conflicting state without certifying integrity before delivery.

These failure classes map directly to the new WRIT dimensions:
- User correction overwritten by later summaries -> `trust_hierarchy`
- Same fact re-extracted in slightly different forms -> `extraction_drift`
- Flush/reset/stale-context corruption -> `failure_injection`
- Superseded, expired, and reinstated facts -> `lifecycle`
- Detect stale/conflicting state before answering -> `certification`

## What changed for WRIT users
- Added 5 new benchmark dimensions: `trust_hierarchy`, `extraction_drift`, `failure_injection`, `lifecycle`, and `certification`.
- Added 25 new scenarios across those dimensions, expanding the benchmark dataset from 52 to 77 scenarios.
- Added `closure` coverage to capture resolved-vs-discussed state, including superseded policy and pricing decision scenarios.
- Expanded aggregate reporting with new metrics for source authority integrity, dedup accuracy, failure resilience, lifecycle accuracy, and pre-delivery detection.

## API surface and contracts
- Extended `ScenarioCategory`, `RequiredCapability`, `FailureMode`, `ScenarioScores`, and `AggregateScores` in the TypeScript API.
- Added `source_authority` on memory events.
- Added `lifecycle_history`, `expected_entity_count`, and `expected_integrity_flag` to scenario ground truth.
- Extended adapter capabilities with support declarations for source authority, deduplication, lifecycle tracking, and pre-delivery certification.

## Behavior changes
- The benchmark can now distinguish retrieval failures from write-authority failures, dedup failures, lifecycle blindness, and certification misses.
- Markdown and JSON reports now surface the new aggregate metrics and category-level breakdowns.
- Scenario validation now recognizes the new categories and enforces category-specific structural requirements.

## Docs site & CI / tooling
- Updated WRIT docs for authoring, metrics, and adapter implementation to cover the new dimensions and scenario fields.
- Fixed a CLI import side effect where `report.ts` executed on module import, which broke the GitHub Actions `benchmark-baseline` workflow when `cli.ts` imported `generateMarkdownReport`.

## Internal changes
- Refactored evaluator scoring and aggregation to support dimension-specific metrics while preserving null-skipping behavior for unsupported adapter capabilities.
- Updated built-in adapters to advertise the extended capability surface.

## Fixes
- Fixed the benchmark CLI / report interaction so `npx tsx src/cli.ts --adapter baseline ...` no longer crashes by treating `--adapter` as a results directory.

## Tests and validation
- `npx tsc --noEmit`
- `npx vitest run`
- Local reproduction of the baseline benchmark CLI run
- Local verification that standalone `src/report.ts` CLI still works after the entry-point guard fix

## Breaking changes
- None, but custom adapters and any code that exhaustively matches scenario categories, required capabilities, failure modes, or aggregate score keys must be updated for the expanded WRIT type surface.
