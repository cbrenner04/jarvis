# Render and filter pipeline list

## Problem

`jarvis pipeline list` prints the complete daemon snapshot as one minified JSON line, making routine discovery and triage difficult.

## Decisions

- Keep the parameterless, one-shot `pipeline_list` request and response unchanged; rules out daemon, persistence, and TUI changes for CLI presentation.
- Make the default a headerless, tab-separated row per pipeline with columns `id`, `name`, `state`, `seed`, `created`, and `stages` in that order; rules out the JSON blob or a labeled header as the human default.
- Render `id` as the first eight `pipelineId` characters and `seed` as the `seedPath` basename or `-`; short IDs are display-only, which rules out implicit prefix resolution by control commands.
- Display the daemon-returned pipeline `state` verbatim; rules out duplicating the daemon state model or changing its precedence in the CLI.
- Group stage rows by `stageId`, order groups by durable `position` ascending, and render space-separated `<glyph><stageId>` entries with `×N` when a group contains multiple rows; rules out repeating branch records in the human summary.
- Choose each stage glyph by status precedence `interrupted`, `rejected`, `failed`, `running`, `awaiting`, `pending`, `skipped`, `approved`, `succeeded`, mapping them respectively to `!`, `✗`, `✗`, `●`, `?`, `·`, `–`, `✓`, `✓`; rules out last-row wins or prose status summaries.
- Format created age as the floored elapsed largest unit among `d`, `h`, `m`, and `s`, with less than one second as `0s`; rules out fractional or locale-dependent timestamps.
- Filter human rows inclusively by `createdAt >= cutoff` and exact pipeline state, where an absent `--since` uses the numeric sentinel cutoff `-Infinity` (never `undefined`), then sort by `createdAt` descending with `pipelineId` ascending as the tie break; rules out server order, fuzzy state matching, unstable ties, and an optional-cutoff branch.
- Accept positive `<integer>d|h|m|s` durations or `Date.parse`-accepted timestamps for `--since` (deliberately narrower than `run list --since`: no numeric epochs), and accept only `pending`, `running`, `awaiting-approval`, `succeeded`, `failed`, `rejected`, or `interrupted` for `--state`; every parse failure, unknown flag, or extra positional prints `PIPELINE_LIST_USAGE` (extra positionals deliberately move from `PIPELINE_USAGE` to `PIPELINE_LIST_USAGE`); rules out numeric epochs, `run list`-style `invalid_since` stderr, and a new filter grammar.
- Treat `--json` as the sole format switch: alone it prints the current serialized snapshot unchanged and it cannot combine with human filters; rules out reshaping machine output or silently ignoring filters.
- Print `No pipelines.` with exit `0` for an empty human selection; rules out an empty table or JSON object.

## Tasks

- Parse `pipeline list` flags, filter and deterministically sort snapshots, render human rows and collapsed authored-stage summaries, and preserve the one-request JSON compatibility path in `v2/src/commands/pipeline.ts`.
- Add parser/help declarations for `--json`, `--since`, and `--state` in `v2/src/cli/command-help-flags.ts`, `v2/src/cli/command-tree.ts`, `v2/src/cli/help-flags-parity.ts`, and `v2/src/cli/usage.ts`.
- Replace and extend `v2/src/commands/pipeline.test.ts` list coverage with fixed-clock human, filter, usage, empty, JSON compatibility, and mutation-checkpoint cases; extend `v2/src/cli/help-flags-parity.test.ts`.
- Align the durable CLI contract and operator workflow documentation listed below.

## Acceptance criteria

- [x] `v2/src/commands/pipeline.test.ts` test `list renders one human row per pipeline` fails against the pre-fix JSON default and pins headerless tab-separated column order, first-eight-character IDs, raw returned states, seed basenames, all stage glyphs and precedence tiers, durable-position order, `×N` branch collapse, `d`/`h`/`m`/`s`/`0s` ages, newest-first order, and ascending-ID tie breaks.
- [x] `v2/src/commands/pipeline.test.ts` — `list renders one human row per pipeline`; Keystone checkpoint: the human path emits rows through the single statement `io.stdout(renderPipelineListRows(selected, deps.now()));` with `snapshot` in scope, the test contains `// @mutate v2/src/commands/pipeline.ts "io.stdout(renderPipelineListRows(selected, deps.now()));" -> "io.stdout(`${JSON.stringify(snapshot)}\n`);"`, and fails when applied.
- [x] `v2/src/commands/pipeline.test.ts` pins inclusive duration and ISO `--since` cutoffs, exact `--state` filtering, conjunctive filters, and absent-filter selection of every pipeline.
- [x] `v2/src/commands/pipeline.test.ts` — `list filters human output by cutoff and exact pipeline state`; Mutation checkpoint: the test contains `// @mutate v2/src/commands/pipeline.ts "return pipeline.createdAt >= cutoff && (state === undefined || pipeline.state === state);" -> "return true;"` and fails when applied.
- [x] `v2/src/commands/pipeline.test.ts` pins unknown flags, invalid or missing `--since` and `--state` values, and extra positionals as `PIPELINE_LIST_USAGE` on stderr with exit `1` before any `pipeline_list` request is sent.
- [x] `v2/src/commands/pipeline.test.ts` — `list --json preserves the unmodified pipeline_list snapshot`; Mutation checkpoint: stdout is byte-for-byte the current serialized stubbed `pipeline_list` result, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json) {" -> "if (false) {"`, and fails when applied.
- [x] `v2/src/commands/pipeline.test.ts` — `list rejects json combined with human filters`; Mutation checkpoint: both incompatible combinations print `PIPELINE_LIST_USAGE`, exit `1` before any `pipeline_list` request, the test contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json && (parsed.since !== undefined || parsed.state !== undefined)) {" -> "if (false) {"`, and fails when applied.
- [x] `v2/src/commands/pipeline.test.ts` — `list reports no pipelines for an empty human selection`; Mutation checkpoint: empty-store and filtered-empty cases print `No pipelines.\n` with exit `0`, the test contains `// @mutate v2/src/commands/pipeline.ts "if (selected.length === 0) {" -> "if (false) {"`, and fails when applied.
- [x] `v2/src/commands/pipeline.test.ts` test `live list returns within 500ms while reporting a non-terminal derived state` is updated to pass `--json` (or assert the human row) and still proves the single non-blocking `pipeline_list` request within 500ms; the other pre-fix default-JSON list tests (`two-branch list stdout shows distinguishable branchKey values and per-branch statuses`, the minified-snapshot and empty-array cases) are rewritten to `--json` or human-row assertions rather than left parsing default stdout as JSON.
- [x] `v2/src/cli/help-flags-parity.test.ts` pins parser/help parity for `--json`, `--since`, and `--state` through a new `["pipeline", "list"]` `PARITY_PATHS` entry and matching parse-options constant in `v2/src/cli/help-flags-parity.ts`; `jarvis help pipeline list` shows the flags and `PIPELINE_LIST_USAGE` lists their accepted shapes.
- [x] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/v1-behaviors.md` describe the shipped human default, filters, empty result, collapsed branch summary, full-ID and branch-key control path, and unchanged `--json` snapshot compatibility without changing TUI guidance.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — replace the JSON-default CLI contract with the human rows, filters, empty result, one-shot request, and unchanged `--json` snapshot path.
- `v2/docs/operator-runbook.md` — document default columns and stage summary, filters, empty output, display-only short IDs, full IDs and branch keys via start output, wait boundaries, or `--json`, and machine compatibility.
- `v2/docs/first-workflow-walkthrough.md` — use the default row for discovery and retain full IDs plus branch-specific approval identity through start output, `pipeline wait`, or `--json`.
- `v2/docs/v1-behaviors.md` — record the changed v2 CLI default and preserved JSON compatibility path.
- `v2/src/cli/usage.ts` and structured command help — list `--json`, `--since`, and `--state` with accepted values.
