---
name: run-kill-force-flag
---

# `jarvis run kill --force <id>` clears a stale non-active run

## Problem

`runActionCommand` (`v2/src/commands/run.ts`) rejects anything but a single positional and always sends `kill { runId }`, so the operator has no way to reach the daemon's force-settlement path. A stale `paused` row that resume refuses stays in `run list` and the tui work tree with no CLI clear path.

## Decisions

- Parse `--force` on `kill` only; `pause` and `resume` keep their exact-one-positional usage — rules out a shared flag that would imply a nonexistent forced pause/resume.
- `--force` on an already-active run is accepted and forwarded, so the operator does not have to know a run's liveness before typing the command; the daemon decides which path runs.
- Success output stays `killed <id>` on both paths — rules out a distinct force-worded line that operators and `run list` scripts would have to distinguish.
- `run_not_active` from a force attempt still exits 1 with the formatted RPC error — rules out swallowing it as success.
- No tui dock command change: the tui kill binding keeps sending unforced `kill`.

## Acceptance criteria

- [ ] `jarvis run kill --force <id>` sends `kill` with the force param and prints `killed <id>`, pinned by a CLI test.
- [ ] `jarvis run kill <id>` still sends `kill` without force, pinned by a test.
- [ ] `--force` on `pause` or `resume` is a usage error (exit 1, `RUN_USAGE` on stderr), pinned by a test.
- [ ] A daemon-side refusal on a forced kill exits 1 with the formatted RPC error, pinned by a test.
- [ ] `run kill --force` appears in `run kill` help/usage output, pinned by the help-flags parity guard.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — clearing a stale `paused`/unresumable run with `run kill --force`, when to reach for it versus `resume`, and that the durable row is retained (settled, not deleted); cross-link the pipeline display-clearing seeds.

## Prerequisites

- The `kill` RPC accepts a force param that settles a non-active, non-boundary-terminal run to `killed` with a recorded `finished_at`.
- Forced kill of an active run still takes the normal abort path.
- Force-settled rows are subject to normal terminal list retention.
