# Daemon

## Problem

`jarvis pipeline list` prints the full daemon snapshot as one minified JSON line, obscuring routine pipeline discovery and triage.

## Decisions

- Default stdout is one tab-separated row per selected pipeline, without a header: first eight `pipelineId` characters, name, derived state, seed basename or `-`, created age, and space-separated stage summary; this rules out retaining JSON or adding a header as the human default.
- The eight-character ID is display-only; `wait`, `approve`, `reject`, and `resume` continue requiring the full ID from `pipeline start` stdout or `pipeline list --json`, ruling out implicit prefix resolution.
- Group stage rows by `stageId`, order groups by durable `position` ascending, and render each as `<glyph><stageId>` with `×N` when the group has more than one durable row; glyph precedence is `interrupted`, `rejected`, `failed`, `running`, `awaiting`, `pending`, `skipped`, `approved`, `succeeded`, ruling out branch-row repetition or branch-key exposure in the human summary.
- Map `succeeded` and `approved` to `✓`, `failed` and `rejected` to `✗`, `interrupted` to `!`, `running` to `●`, `awaiting` to `?`, `pending` to `·`, and `skipped` to `–`, ruling out prose stage statuses in the summary.
- Format created age as the floored elapsed largest unit among `d`, `h`, `m`, and `s`; values below one second render `0s`, ruling out locale timestamps and fractional units.
- Sort human rows by `createdAt` descending and then `pipelineId` ascending; apply `--since` inclusively and `--state` exactly before rendering, ruling out server-side order and unstable ties.
- `--json` is the sole format switch and cannot combine with `--since` or `--state`; alone it prints the current serialized `pipeline_list` snapshot byte-for-byte, ruling out machine-output reshaping.

## Work

- Parse list flags, select and sort snapshots, render human rows and collapsed stage summaries, and preserve the JSON compatibility branch in `v2/src/commands/pipeline.ts`.
- Declare list parser/help flags in `v2/src/cli/command-help-flags.ts`, register them in `v2/src/cli/command-tree.ts` and `v2/src/cli/help-flags-parity.ts`, and align `PIPELINE_LIST_USAGE`.
- Replace and extend `v2/src/commands/pipeline.test.ts` list coverage with fixed-clock human, filter, usage, empty, and JSON compatibility cases plus mutation checkpoints; extend help parity coverage.
- Update the durable CLI contract and operator guidance in the documentation listed below.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` adds default single- and multi-branch list tests that fail against the pre-fix JSON default and pin tab-separated column order, first-eight-character IDs, raw derived states, seed basenames, every stage glyph and precedence tier, durable-position group order, `×N` branch collapse, `d`/`h`/`m`/`s`/`0s` ages, newest-first order, and ascending-ID tie breaks.
- [ ] `v2/src/commands/pipeline.test.ts` — `list renders one human row per pipeline`; Keystone checkpoint: the test contains a single-line `// @mutate` that replaces the default human render call with the baseline `JSON.stringify(snapshot)` serialization, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list filters human output by cutoff and exact pipeline state`; Mutation checkpoint: the test contains `// @mutate v2/src/commands/pipeline.ts "return pipeline.createdAt >= cutoff && (state === undefined || pipeline.state === state);" -> "return true;"` and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list --json preserves the unmodified daemon snapshot`; Mutation checkpoint: stdout is byte-for-byte the current serialized stubbed `pipeline_list` result, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json) {" -> "if (false) {"`, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list rejects json combined with human filters`; Mutation checkpoint: each `--json` plus human-filter combination prints `PIPELINE_LIST_USAGE`, exits `1` before any `pipeline_list` request, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json && (parsed.since !== undefined || parsed.state !== undefined)) {" -> "if (false) {"`, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list reports no pipelines for an empty human selection`; Mutation checkpoint: an empty store and filtered-empty selection print `No pipelines.` with exit `0`, the test contains `// @mutate v2/src/commands/pipeline.ts "if (selected.length === 0) {" -> "if (false) {"`, and fails when applied.
- [ ] Every added or modified list guard beyond the four named checkpoints is source-inverted from its pinning test and makes the scoped suite fail; no production inversion hook is added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — replace the JSON-default pipeline-list contract with the human rows, filters, empty result, one-shot `pipeline_list` request, and unchanged `--json` snapshot path.
- `v2/docs/operator-runbook.md` — document default columns and stage summary, filters, empty output, display-only short IDs, full IDs and branch keys via start output, wait boundaries, or `--json`, and machine compatibility.
- `v2/docs/first-workflow-walkthrough.md` — use the default list row for discovery; use the retained full start ID or `--json` for commands and `pipeline wait` or `--json` for branch-specific approval identity because the human summary collapses branches.
