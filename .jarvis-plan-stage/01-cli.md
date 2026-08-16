# CLI

## Problem

`jarvis pipeline list` prints the full daemon snapshot as one minified JSON line, obscuring routine pipeline discovery and triage.

## Decisions

- Keep the parameterless, one-shot `pipeline_list` request and its response unchanged; filtering, sorting, and rendering stay in the CLI, ruling out server-side and TUI changes.
- Display the returned pipeline `state` verbatim; its existing precedence remains `interrupted`, `rejected`, `failed`, `running`, `awaiting-approval`, `pending`, terminal-publication `running`, terminal-publication `failed`, then `succeeded`, ruling out a CLI state model.
- `--since` accepts positive `<integer>d|h|m|s` durations relative to the CLI clock or a `Date.parse`-accepted ISO timestamp; `--state` accepts exactly `pending`, `running`, `awaiting-approval`, `succeeded`, `failed`, `rejected`, or `interrupted`, ruling out a new filter grammar.
- An empty human selection prints `No pipelines.` and exits `0`; invalid, missing, unknown, or incompatible flags print `PIPELINE_LIST_USAGE` and exit `1`, ruling out an empty table or partial parsing.

## Work

- Parse list flags, select and sort snapshots, render human rows and collapsed stage summaries, and preserve the JSON compatibility branch in `v2/src/commands/pipeline.ts`.
- Declare list parser/help flags in `v2/src/cli/command-help-flags.ts`, register them in `v2/src/cli/command-tree.ts` and `v2/src/cli/help-flags-parity.ts`, and align `PIPELINE_LIST_USAGE`.
- Replace and extend `v2/src/commands/pipeline.test.ts` list coverage with fixed-clock human, filter, usage, empty, and JSON compatibility cases plus mutation checkpoints; extend help parity coverage.
- Update the durable CLI contract and operator guidance in the documentation listed below.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` pins inclusive `--since` duration and timestamp cutoffs, exact `--state` filtering, conjunctive filters, and `PIPELINE_LIST_USAGE` with exit `1` and no `pipeline_list` request for unknown flags, invalid values, or missing values.
- [ ] `v2/src/cli/help-flags-parity.test.ts` pins parser/help parity for `--json`, `--since`, and `--state`; `jarvis help pipeline list` shows the flags and `PIPELINE_LIST_USAGE` lists their accepted shapes.
- [ ] `v2/src/commands/pipeline.test.ts` test `live list returns within 500ms while reporting a non-terminal derived state` stays green, proving the CLI still issues one non-blocking `pipeline_list` snapshot request.
- [ ] `v2/docs/write-behavior.md` records the CLI output contract; `v2/docs/operator-runbook.md` documents operator use; `v2/docs/first-workflow-walkthrough.md` uses the human row for discovery and full IDs plus branch keys for control; `v2/docs/v1-behaviors.md` records the v2 behavior change; TUI guidance stays unchanged.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the changed v2 CLI default and preserved JSON compatibility path.
- `v2/src/cli/usage.ts`, `v2/src/cli/command-help-flags.ts`, and structured command help — list `--json`, `--since`, and `--state` with accepted values.
