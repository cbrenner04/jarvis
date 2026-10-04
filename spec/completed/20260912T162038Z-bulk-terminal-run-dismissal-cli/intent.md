---
name: bulk-terminal-run-dismissal-cli
---

# Add project-scoped bulk run dismissal to the CLI

## Prerequisites

- The state store atomically dismisses every previously undismissed terminal run matching an exact project selection, includes terminal step rows belonging to matched workflow-entry invocations, leaves every nonterminal row and lifecycle field unchanged, and returns the number of rows newly dismissed.
- The daemon `dismiss` request accepts exactly one of a run ID or an exact project bulk selector, delegates bulk terminal selection to the store, and returns a validated applied result carrying the dismissed-row count without changing live-run execution.

## Primary implementation surface

`v2/src/commands/run.ts`

## Problem

`jarvis run dismiss` requires one ID, forcing operators to pipe a retained listing into repeated commands. Because default `run list` shows only the fifty newest terminal rows, each pass can reveal older rows and make the project appear not to shrink.

## Behavior

- `jarvis run dismiss --project <name>` dismisses all durable terminal rows for the exact project, including terminal workflow step rows, leaves nonterminal rows untouched, and reports the number of rows dismissed.

## Decisions

- Admit either one positional run ID or `--project <name>`; refuse both with a named CLI error before contacting the daemon.
- Reuse `run list --project` exact-match semantics while letting the daemon/store select beyond list retention; rules out a client-side list-and-loop implementation.
- Keep positional dismissal output and `run undismiss` unchanged; bulk undismiss and `pipeline dismiss` are out of scope.

## Acceptance criteria

- [ ] A CLI regression test proves `run dismiss --project <name>` issues one bulk request, dismisses every terminal row for that project including workflow step rows, leaves live rows untouched, and fails against the pre-fix single-ID signature.
- [ ] A CLI test proves bulk dismissal prints the dismissed-row count.
- [ ] A CLI test proves a positional run ID combined with `--project` exits non-zero with a named error and sends no RPC.
- [ ] Help and usage tests document the positional and project-selector forms.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — bulk project dismissal, terminal/workflow-step scope, count output, and why the default fifty-terminal-row retention window makes repeated single-row dismissal appear to refill the list.
- `v2/docs/write-behavior.md` — `run dismiss` grammar, exclusive selector admission, request, output, and exit semantics.
- `v2/docs/v1-behaviors.md` — record the operator-facing bulk dismissal behavior.
