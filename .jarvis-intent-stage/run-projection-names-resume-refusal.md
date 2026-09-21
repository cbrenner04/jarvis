---
name: run-projection-names-resume-refusal
---

# `run list` / `run wait` name a structural resume refusal instead of advertising resume

## Problem

After a structurally refused resume, `run list` keeps advertising `resumable: true` / `nextAction: resume`, hiding that the operator must resolve a blocking condition first.

## Decisions

- A run carrying a recorded structural resume refusal projects a named blocking state with the refusal reason on `run list` and `run wait`, not `resumable: true` / `nextAction: resume`.
- The blocking state clears when a later resume is admitted.

## Acceptance criteria

- [ ] A run whose resume was refused by the `stale reuse refused` gate projects the named blocking state and reason on `run list` and `run wait`; regression fails against the pre-fix `nextAction: resume` projection.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the named refused-resume state and how to clear it.

## Prerequisites

- The daemon records a structural resume refusal (verbatim reason) on the run when `run resume` is refused by an admission gate.
