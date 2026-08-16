# Render and filter pipeline list

## Problem

`jarvis pipeline list` prints the full daemon snapshot as one minified JSON line, obscuring routine pipeline discovery and triage.

## Decisions

- Keep the parameterless, one-shot `pipeline_list` RPC and its response unchanged; filtering, sorting, and rendering stay in the CLI, ruling out daemon, persistence, and TUI changes.
- Default stdout is one tab-separated row per selected pipeline, without a header: first eight `pipelineId` characters, name, daemon-derived state, seed basename or `-`, created age, and space-separated stage summary; this rules out retaining JSON or adding a header as the human default.
- The eight-character ID is display-only; `wait`, `approve`, `reject`, and `resume` continue requiring the full ID from `pipeline start` stdout or `pipeline list --json`, ruling out implicit prefix resolution.
- Display pipeline `state` verbatim; its daemon precedence remains `interrupted`, `rejected`, `failed`, `running`, `awaiting-approval`, `pending`, terminal-publication `running`, terminal-publication `failed`, then `succeeded`, ruling out a CLI state model.
- Group stage rows by `stageId`, order groups by durable `position` ascending, and render each as `<glyph><stageId>` with `×N` when the group has more than one durable row; glyph precedence is `interrupted`, `rejected`, `failed`, `running`, `awaiting`, `pending`, `skipped`, `approved`, `succeeded`, ruling out branch-row repetition or branch-key exposure in the human summary.
- Map `succeeded` and `approved` to `✓`, `failed` and `rejected` to `✗`, `interrupted` to `!`, `running` to `●`, `awaiting` to `?`, `pending` to `·`, and `skipped` to `–`, ruling out prose stage statuses in the summary.
- Format created age as the floored elapsed largest unit among `d`, `h`, `m`, and `s`; values below one second render `0s`, ruling out locale timestamps and fractional units.
- Sort human rows by `createdAt` descending and then `pipelineId` ascending; apply `--since` inclusively and `--state` exactly before rendering, ruling out daemon order and unstable ties.
- `--since` accepts positive `<integer>d|h|m|s` durations relative to the CLI clock or a `Date.parse`-accepted ISO timestamp; `--state` accepts exactly `pending`, `running`, `awaiting-approval`, `succeeded`, `failed`, `rejected`, or `interrupted`, ruling out a new filter grammar.
- `--json` is the sole format switch and cannot combine with `--since` or `--state`; alone it prints the current serialized `pipeline_list` snapshot byte-for-byte, ruling out machine-output reshaping.
- An empty human selection prints `No pipelines.` and exits `0`; invalid, missing, unknown, or incompatible flags print `PIPELINE_LIST_USAGE` and exit `1`, ruling out an empty table or partial parsing.

## Work

- Parse list flags, select and sort snapshots, render human rows and collapsed stage summaries, and preserve the JSON compatibility branch in `v2/src/commands/pipeline.ts`.
- Declare list parser/help flags in `v2/src/cli/command-help-flags.ts`, register them in `v2/src/cli/command-tree.ts` and `v2/src/cli/help-flags-parity.ts`, and align `PIPELINE_LIST_USAGE`.
- Replace and extend `v2/src/commands/pipeline.test.ts` list coverage with fixed-clock human, filter, usage, empty, and JSON compatibility cases plus mutation checkpoints; extend help parity coverage.
- Update the durable CLI contract and operator guidance in the documentation listed below.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` adds default single- and multi-branch list tests that fail against the pre-fix JSON default and pin tab-separated column order, first-eight-character IDs, raw daemon states, seed basenames, every stage glyph and precedence tier, durable-position group order, `×N` branch collapse, `d`/`h`/`m`/`s`/`0s` ages, newest-first order, and ascending-ID tie breaks.
- [ ] `v2/src/commands/pipeline.test.ts` — `list renders one human row per pipeline`; Keystone checkpoint: the test contains a single-line `// @mutate` that replaces the default human render call with the baseline `JSON.stringify(snapshot)` serialization, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` pins inclusive `--since` duration and timestamp cutoffs, exact `--state` filtering, conjunctive filters, and `PIPELINE_LIST_USAGE` with exit `1` and no RPC for unknown flags, invalid values, or missing values.
- [ ] `v2/src/commands/pipeline.test.ts` — `list filters human output by cutoff and exact pipeline state`; Mutation checkpoint: the test contains `// @mutate v2/src/commands/pipeline.ts "return pipeline.createdAt >= cutoff && (state === undefined || pipeline.state === state);" -> "return true;"` and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list --json preserves the unmodified daemon snapshot`; Mutation checkpoint: stdout is byte-for-byte the current serialized stubbed `pipeline_list` result, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json) {" -> "if (false) {"`, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list rejects json combined with human filters`; Mutation checkpoint: each `--json` plus human-filter combination prints `PIPELINE_LIST_USAGE`, exits `1` before RPC, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json && (parsed.since !== undefined || parsed.state !== undefined)) {" -> "if (false) {"`, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list reports no pipelines for an empty human selection`; Mutation checkpoint: an empty store and filtered-empty selection print `No pipelines.` with exit `0`, the test contains `// @mutate v2/src/commands/pipeline.ts "if (selected.length === 0) {" -> "if (false) {"`, and fails when applied.
- [ ] Every added or modified list guard beyond the four named checkpoints is source-inverted from its pinning test and makes the scoped suite fail; no production inversion hook is added.
- [ ] `v2/src/cli/help-flags-parity.test.ts` pins parser/help parity for `--json`, `--since`, and `--state`; `jarvis help pipeline list` shows the flags and `PIPELINE_LIST_USAGE` lists their accepted shapes.
- [ ] `v2/src/commands/pipeline.test.ts` test `live list returns within 500ms while reporting a non-terminal derived state` stays green, proving the CLI still issues one non-blocking snapshot RPC.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/v1-behaviors.md` describe the shipped human default, filters, empty result, JSON compatibility path, display-only short ID, and full-ID/branch-key recovery for control commands without changing TUI guidance.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — replace the JSON-default pipeline-list contract with the human rows, filters, empty result, one-shot RPC, and unchanged `--json` snapshot path.
- `v2/docs/operator-runbook.md` — document default columns and stage summary, filters, empty output, display-only short IDs, full IDs and branch keys via start output, wait boundaries, or `--json`, and machine compatibility.
- `v2/docs/first-workflow-walkthrough.md` — use the default list row for discovery; use the retained full start ID or `--json` for commands and `pipeline wait` or `--json` for branch-specific approval identity because the human summary collapses branches.
- `v2/docs/v1-behaviors.md` — record the changed v2 CLI default and preserved JSON compatibility path.
- `v2/src/cli/usage.ts`, `v2/src/cli/command-help-flags.ts`, and structured command help — list `--json`, `--since`, and `--state` with accepted values.
