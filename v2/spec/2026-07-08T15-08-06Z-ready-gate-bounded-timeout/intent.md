---
name: ready-gate-bounded-timeout
---

# Ready-gate command execution gets a bounded, named timeout

`ready-gate.ts` runs `bun run ready` / `bun run fix` (or the project's
`readyCommand` / `fixCommand` override) via `execFileSync` with no timeout at
all, so a hung verification or fix command blocks the completion/pre-shrink/
review ready gate indefinitely instead of hard-failing. Bound it to the
operator's timeout budget and name the failing command/phase on abort.

## Decisions

- Ready-gate `execFileSync` calls (fix and verification) get a `timeout`
  matching the configured budget (reuse `iterationTimeoutMs`, default 10 min)
  — rules out leaving these calls unbounded while every other jarvis operation
  gets a budget.
- On timeout, the reported failure names the command that exceeded the budget
  (`readyCommand`/`fixCommand`/built-in `bun run ready`/`bun run fix`) and the
  gate site (completion transition, pre-shrink, review baseline/final,
  `maybeMarkReady`) — rules out a bare `ETIMEDOUT`/generic execFileSync error
  reaching the operator.
- Budget stays operator-configurable via existing `iterationTimeoutMs`
  config, not a new hardcoded constant.

## Out of scope

- CI job-level (`ci.yml`) timeout tuning.

## Documentation updates

- `v1/docs/config.md`: note the ready gate is bounded by `iterationTimeoutMs`.
- `v1/docs/run-loop.md` and `v1/docs/worktrees-and-commits.md`: document the
  bounded ready-gate behavior and named timeout failure at the relevant gate
  descriptions.
- `v1/docs/operator-runbook.md`: record that a hung `bun run ready`/`fix` now
  hard-fails within the budget with a named reason, instead of hanging.

## Acceptance criteria

- [ ] A `bun run ready` (or `readyCommand`) invocation that exceeds the
      configured budget aborts instead of hanging indefinitely.
- [ ] The abort failure names which command and which gate site exceeded the
      budget.
- [ ] Budget is read from `iterationTimeoutMs`, not a separate hardcoded value.

## Prerequisites

- Default iteration timeout budget policy (10 min) exists in config.
