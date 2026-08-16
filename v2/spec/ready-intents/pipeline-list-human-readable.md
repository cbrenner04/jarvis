---
name: pipeline-list-human-readable
---
# Make pipeline list human-readable

## Prerequisites

## Primary implementation surface

v2/src/commands/pipeline.ts

Unsplit rationale: Parsing, filtering, sorting, and rendering all belong to the CLI module boundary, so splitting does not apply.

## Problem

- `jarvis pipeline list` emits the full daemon snapshot as one minified JSON line, making routine pipeline discovery and triage impractical.

## Decisions

- Keep `pipeline_list` request and response semantics unchanged and perform filtering, newest-first sorting, and rendering in the CLI; rules out daemon and persistence changes for presentation-only behavior.
- Default output is one row per pipeline with the first eight characters of `pipelineId`, name, daemon-derived state, seed basename or `-`, created age, and an authored-stage-order summary; rules out the JSON blob as the human default.
- Display the daemon-returned `state` without re-deriving it: its precedence remains `interrupted`, `rejected`, `failed`, `running`, `awaiting-approval`, `pending`, terminal-publication `running`, terminal-publication `failed`, then `succeeded`; rules out a CLI state model.
- Render `succeeded`/`approved` as `✓`, `failed`/`rejected` as `✗`, `interrupted` as `!`, `running` as `●`, `awaiting` as `?`, `pending` as `·`, and `skipped` as `–`. Group stage rows by `stageId`, order groups by durable `position` ascending, and render `stage×N` when N is greater than one; select its glyph by precedence `interrupted`, `rejected`, `failed`, `running`, `awaiting`, `pending`, `skipped`, `approved`, `succeeded`; rules out repeating every branch record in the default table.
- Format created age as the floored elapsed largest unit among `d`, `h`, `m`, and `s` (for example `2d`, `3h`, `4m`, `5s`; less than one second is `0s`). Sort rows by `createdAt` descending, breaking ties by `pipelineId` ascending; rules out locale-dependent timestamps and unstable ordering.
- Accept `--since <duration|ISO>` and `--state <state>` in human mode. `--since` accepts the existing positive `<integer>d|h|m|s` duration or any `Date.parse`-accepted ISO timestamp and keeps pipelines whose `createdAt` is at least the cutoff; `--state` exactly matches one of `pending`, `running`, `awaiting-approval`, `succeeded`, `failed`, `rejected`, or `interrupted`; absent filters return every pipeline; rules out a new filter grammar.
- Treat `--json` as the sole output-format switch: it cannot be combined with `--since` or `--state`, and alone prints the unmodified `pipeline_list` result with the current serialization; rules out breaking machine consumers or reshaping the RPC payload.
- Print `No pipelines.` on stdout with exit `0` when the selected result is empty; rules out an empty table or empty JSON object in human mode.
- Leave the TUI unchanged; rules out coupling this CLI presentation change to interactive monitoring.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` fails against the pre-fix behavior and pins default `jarvis pipeline list` output for stubbed single- and multi-branch snapshots: first-eight-character ids, state/glyph mapping and precedence, age formatting, durable-position stage order, branch collapse, and deterministic newest-first ordering.
- [ ] `v2/src/commands/pipeline.test.ts` pins `--since` and exact `--state` filtering, accepted duration and ISO cutoffs, and unknown, invalid, or missing flag usage errors.
- [ ] `v2/src/commands/pipeline.test.ts` test `list filters human output by cutoff and exact pipeline state` contains `// @mutate v2/src/commands/pipeline.ts "return pipeline.createdAt >= cutoff && (state === undefined || pipeline.state === state);" -> "return true;"` and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` asserts `jarvis pipeline list --json` stdout is byte-for-byte the current serialized stubbed `pipeline_list` result, and rejects `--json` combined with a human filter using `PIPELINE_LIST_USAGE` and exit `1`.
- [ ] `v2/src/commands/pipeline.test.ts` test `list --json preserves the unmodified daemon snapshot` contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json) {" -> "if (false) {"` and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` test `list rejects json combined with human filters` contains `// @mutate v2/src/commands/pipeline.ts "if (parsed.json && (parsed.since !== undefined || parsed.state !== undefined)) {" -> "if (false) {"` and fails when applied.
- [ ] `v2/src/commands/pipeline.test.ts` asserts an empty human result prints `No pipelines.` with exit `0`, while parse failures print `PIPELINE_LIST_USAGE` and exit `1`.
- [ ] `v2/src/commands/pipeline.test.ts` test `list reports no pipelines for an empty human selection` contains `// @mutate v2/src/commands/pipeline.ts "if (selected.length === 0) {" -> "if (false) {"` and fails when applied.
- [ ] `v2/src/cli/help-flags-parity.test.ts` pins parser/help parity for `--json`, `--since`, and `--state` through `PIPELINE_LIST_USAGE` and structured help flags.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` documents the default table, filters, empty output, and `--json` compatibility path.
- `v2/docs/first-workflow-walkthrough.md` uses the default list table to locate a pipeline id and keeps branch-specific approval guidance accurate for collapsed summaries.
- `v2/docs/v1-behaviors.md` records the changed v2 CLI default and the preserved JSON compatibility path.
- `v2/src/cli/usage.ts` and structured command help list the accepted flags.
