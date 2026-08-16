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
- Default output is one row per pipeline with short id, name, derived state, seed basename or `-`, created age, and an authored-stage-order summary; rules out the JSON blob as the human default.
- Render one glyph per stage status and collapse multiple branch records for one stage to `stage×N` with the dominant status; rules out repeating every branch record in the default table.
- Accept `--since <duration|ISO>` and `--state <state>` using existing `run list` cutoff semantics where applicable, with absent filters returning every pipeline; rules out a new filter grammar.
- Treat `--json` as the sole output-format switch and print the unmodified `pipeline_list` result with the current serialization; rules out breaking machine consumers or reshaping the RPC payload.
- Print `No pipelines.` on stdout with exit `0` when the selected result is empty; rules out an empty table or empty JSON object in human mode.
- Leave the TUI unchanged; rules out coupling this CLI presentation change to interactive monitoring.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` fails against the pre-fix behavior and pins default `jarvis pipeline list` output for stubbed single- and multi-branch snapshots: one row per pipeline, required columns, authored-stage-order summaries, branch collapse, and newest-first ordering.
- [ ] `v2/src/commands/pipeline.test.ts` pins `--since` and `--state` filtering, accepted duration and ISO cutoffs, and unknown-flag usage errors.
- [ ] `v2/src/commands/pipeline.test.ts` asserts `jarvis pipeline list --json` stdout is byte-for-byte the current serialized stubbed `pipeline_list` result.
- [ ] `v2/src/commands/pipeline.test.ts` asserts an empty human result prints `No pipelines.` with exit `0`, while parse failures print `PIPELINE_LIST_USAGE` and exit `1`.
- [ ] `v2/src/cli/help-flags-parity.test.ts` pins parser/help parity for `--json`, `--since`, and `--state` through `PIPELINE_LIST_USAGE` and structured help flags.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` documents the default table, filters, empty output, and `--json` compatibility path.
- `v2/docs/first-workflow-walkthrough.md` uses the default list table to locate a pipeline id and keeps branch-specific approval guidance accurate for collapsed summaries.
- `v2/docs/v1-behaviors.md` records the changed v2 CLI default and the preserved JSON compatibility path.
- `v2/src/cli/usage.ts` and structured command help list the accepted flags.
