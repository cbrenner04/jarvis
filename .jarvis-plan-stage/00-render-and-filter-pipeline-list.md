# Render and filter pipeline list

## Problem

`jarvis pipeline list` prints the complete daemon snapshot as one minified JSON line, making routine discovery and triage difficult.

## Decisions

- Keep the parameterless, one-shot `pipeline_list` request and response unchanged; rules out daemon, persistence, and TUI changes for CLI presentation.
- Make the default a headerless, tab-separated row per pipeline with columns `id`, `name`, `state`, `seed`, `created`, and `stages` in that order, matching the existing `run list` row convention; rules out the JSON blob or a labeled header as the human default.
- Render `id` as the first eight `pipelineId` characters and `seed` as the `seedPath` basename or `-`; short IDs are display-only, which rules out implicit prefix resolution by control commands.
- Display the daemon-returned pipeline `state` verbatim; rules out duplicating the daemon state model or changing its precedence in the CLI.
- Group stage rows by `stageId`, order groups by durable `position` ascending, and render space-separated `<glyph><stageId>` entries with `×N` when a group contains multiple rows; rules out repeating branch records in the human summary.
- Choose each stage glyph by status precedence `interrupted`, `rejected`, `failed`, `running`, `awaiting`, `pending`, `skipped`, `approved`, `succeeded`, mapping them respectively to `!`, `✗`, `✗`, `●`, `?`, `·`, `–`, `✓`, `✓`; rules out last-row wins or prose status summaries.
- Format created age as the floored elapsed largest unit among `d`, `h`, `m`, and `s`, with less than one second as `0s`; rules out fractional or locale-dependent timestamps.
- Filter human rows inclusively by `createdAt >= cutoff` and exact pipeline state, then sort by `createdAt` descending with `pipelineId` ascending as the tie break; rules out server order, fuzzy state matching, and unstable ties.
- Accept positive `<integer>d|h|m|s` durations or `Date.parse`-accepted ISO timestamps for `--since`, and accept only `pending`, `running`, `awaiting-approval`, `succeeded`, `failed`, `rejected`, or `interrupted` for `--state`; rules out numeric epochs and a new filter grammar.
- Treat `--json` as the sole format switch: alone it prints the current serialized snapshot unchanged and it cannot combine with human filters; rules out reshaping machine output or silently ignoring filters.
- Print `No pipelines.` with exit `0` for an empty human selection; rules out an empty table or JSON object.

## Tasks

- Parse `pipeline list` flags, filter and deterministically sort snapshots, render human rows and collapsed authored-stage summaries, and preserve the one-request JSON compatibility path in `v2/src/commands/pipeline.ts`.
- Add parser/help declarations for `--json`, `--since`, and `--state` in `v2/src/cli/command-help-flags.ts`, `v2/src/cli/command-tree.ts`, `v2/src/cli/help-flags-parity.ts`, and `v2/src/cli/usage.ts`.
- Replace and extend `v2/src/commands/pipeline.test.ts` list coverage with fixed-clock human, filter, usage, empty, JSON compatibility, and mutation-checkpoint cases; extend `v2/src/cli/help-flags-parity.test.ts`.
- Align the durable CLI contract and operator workflow documentation listed below.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` test `list renders one human row per pipeline` fails against the pre-fix JSON default and pins headerless tab-separated column order, first-eight-character IDs, raw daemon states, seed basenames, all stage glyphs and precedence tiers, durable-position order, `×N` branch collapse, `d`/`h`/`m`/`s`/`0s` ages, newest-first order, and ascending-ID tie breaks.
- [ ] `v2/src/commands/pipeline.test.ts` — `list renders one human row per pipeline`; Keystone checkpoint: the test contains a single-line `// @mutate` that replaces the unique default human-render stdout statement with the baseline `JSON.stringify(snapshot)` output, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` pins inclusive duration and ISO `--since` cutoffs, exact `--state` filtering, conjunctive filters, and absent-filter selection of every pipeline.
- [ ] `v2/src/commands/pipeline.test.ts` — `list filters human output by cutoff and exact pipeline state`; Mutation checkpoint: the test contains `// @mutate v2/src/commands/pipeline.ts "return pipeline.createdAt >= cutoff && (state === undefined || pipeline.state === state);" -> "return true;"` and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` pins unknown flags, invalid or missing `--since` and `--state` values, and extra positionals as `PIPELINE_LIST_USAGE` on stderr with exit `1` and no daemon request.
- [ ] `v2/src/commands/pipeline.test.ts` — `list --json preserves the unmodified daemon snapshot`; Mutation checkpoint: stdout is byte-for-byte the current serialized stubbed `pipeline_list` result, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json) {" -> "if (false) {"`, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list rejects json combined with human filters`; Mutation checkpoint: both incompatible combinations print `PIPELINE_LIST_USAGE`, exit `1` before daemon contact, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json && (parsed.since !== undefined || parsed.state !== undefined)) {" -> "if (false) {"`, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list reports no pipelines for an empty human selection`; Mutation checkpoint: empty-store and filtered-empty cases print `No pipelines.\n` with exit `0`, the test contains `// @mutate v2/src/commands/pipeline.ts "if (selected.length === 0) {" -> "if (false) {"`, and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` — `list guard inversions fail`; Mutation checkpoint: every added or modified source guard not covered by the named filter, JSON, incompatible-flags, and empty-selection checkpoints has an in-test `// @mutate` source inversion, each mutation makes the scoped suite fail, and no production inversion hook is added.
- [ ] `v2/src/commands/pipeline.test.ts` test `live list returns within 500ms while reporting a non-terminal derived state` stays green, preserving the single non-blocking snapshot request.
- [ ] `v2/src/cli/help-flags-parity.test.ts` pins parser/help parity for `--json`, `--since`, and `--state`; `jarvis help pipeline list` shows the flags and `PIPELINE_LIST_USAGE` lists their accepted shapes.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/v1-behaviors.md` describe the shipped human default, filters, empty result, collapsed branch summary, full-ID and branch-key control path, and unchanged `--json` snapshot compatibility without changing TUI guidance.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — replace the JSON-default CLI contract with the human rows, filters, empty result, one-shot request, and unchanged `--json` snapshot path.
- `v2/docs/operator-runbook.md` — document default columns and stage summary, filters, empty output, display-only short IDs, full IDs and branch keys via start output, wait boundaries, or `--json`, and machine compatibility.
- `v2/docs/first-workflow-walkthrough.md` — use the default row for discovery and retain full IDs plus branch-specific approval identity through start output, `pipeline wait`, or `--json`.
- `v2/docs/v1-behaviors.md` — record the changed v2 CLI default and preserved JSON compatibility path.
- `v2/src/cli/usage.ts` and structured command help — list `--json`, `--since`, and `--state` with accepted values.
