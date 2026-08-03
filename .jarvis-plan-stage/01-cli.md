# CLI

## Problem

The dock submits into an inert handoff, so parsed commands cannot start pipelines or set tree expansion.

## Prerequisites

- `tui-command-parser.ts` returns typed `start`, `expand`, and `collapse` commands plus named errors.
- `admitPipelineStart` owns validated one-request admission and returns before `pipeline_wait`.
- The monitor retains command editor and feedback state, paints four dock rows, and routes focused Enter once through `submitCommand`.

## Decisions

- Bind a detached `admitPipelineStart` callback at the TUI command boundary from the invocation cwd, machine config, project registry/model loaders, pipeline resolver, and auto-start connection/request seams used by `jarvis pipeline start` — rules out invoking the CLI adapter or duplicating pre-admission policy in the monitor.
- Parse errors retain command focus/buffer/cursor and report the parser code; `recognized_unavailable` also reports its exact CLI equivalent — rules out generic usage text or losing repairable input.

## Work

- Expose the production detached-admission callback to `runTuiEntry` without moving CLI presentation or waiting into the TUI.
- Replace the inert submission handoff with one typed asynchronous dispatcher for start and local expansion commands.
- Retain command success/error feedback through refreshes and project it with daemon feedback in the fixed status row.
- Add focused entry, command-boundary, projection, and source-mutation coverage.
- Align durable operator, parity, and TUI-overhaul documentation.

## Acceptance criteria

- [ ] `v2/src/tui/tui-entry.test.tsx` proves every parser error reports its named code, recognized-unavailable feedback includes its exact CLI equivalent, and parse failures retain buffer/cursor and command focus without admission.
- [ ] `v2/docs/operator-runbook.md` § Observe documents dock grammar, retained success/failure outcomes, detached start semantics, explicit expansion/collapse, and CLI fallbacks for unavailable verbs.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — grammar, outcomes, detached start, expansion, and CLI fallbacks.