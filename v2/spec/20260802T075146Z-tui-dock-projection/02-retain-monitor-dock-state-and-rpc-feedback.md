# 02 - Retain monitor dock state and RPC feedback

## Problem

Refreshes can overwrite session-local dock state and hide recoverable monitor failures.

## Decisions

- Production monitor state starts with empty buffer, cursor zero, tree focus, and no command result or RPC error; refresh and display merges preserve those fields.
- Recoverable monitor failures from discovery, `list`, and `pipeline_list` record the latest RPC error without closing the monitor. Their last-good runs and pipeline snapshots remain visible; a succeeding later refresh clears that error.
- A terminal initial refresh failure keeps existing admission feedback behavior and opens no monitor. Command-result production is deferred; a retained result is neither created nor cleared by refresh.

## Work

- Initialize the dock session and latest-RPC-feedback fields introduced by 00 in `v2/src/tui/tui-entry.tsx`.
- Preserve session fields, retained snapshots, and error lifecycle through refresh and display updates.
- Add focused state-retention and recoverable-error regressions in `v2/src/tui/tui-entry.test.tsx`.

## Acceptance criteria

- [x] `v2/src/tui/tui-entry.test.tsx` adds a regression that fails against the baseline and proves initial state has empty buffer, cursor zero, tree focus, and no result/error, then preserves every dock session field across refresh and display updates.
- [x] Recoverable discovery, `list`, and `pipeline_list` failures retain last-good runs/snapshots, show the latest RPC error, and keep the monitor open; a later fully successful refresh clears that error without changing a retained command result.
- [x] An initial all-client failure still follows the existing non-monitor feedback path; no monitor state is opened. `v2/src/tui/tui-entry.test.tsx` initial-refresh feedback test stays green.
- [x] `v2/src/tui/tui-entry.test.tsx` carries a valid `// @mutate` directive for every added or modified executable state/error-lifecycle guard, including guards retaining snapshots or suppressing monitor closure; inverting each real source condition turns its pin red, with no production inversion hook.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — visible error/status documentation lands with the painted dock in 03.
