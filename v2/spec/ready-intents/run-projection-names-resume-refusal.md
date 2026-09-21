---
name: run-projection-names-resume-refusal
---

# `run list` / `run wait` name a structural resume refusal instead of advertising resume

## Problem

After a structurally refused resume, `run list` keeps advertising `resumable: true` / `nextAction: resume`, hiding that the operator must resolve a blocking condition first.

## Decisions

- A run carrying a recorded structural resume refusal projects `resumable: false`, `nextAction: resolve-resume-refusal`, and `resumeRefusal: <verbatim reason>` on `run list` and `run wait`, not `resumable: true` / `nextAction: resume`. The TUI reads the same fields.
- The recorded refusal clears when a later resume is admitted, restoring the normal projection.

## Acceptance criteria

- [ ] A run whose resume was refused by the `stale reuse refused` gate projects `nextAction: resolve-resume-refusal` and `resumeRefusal: <reason>` on `run list` and `run wait`; regression fails against the pre-fix `nextAction: resume` projection.
- [ ] After a later resume of that run is admitted, `run list` no longer projects `resumeRefusal` and `nextAction` reverts to its normal value; fails against a projection that never clears.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `resolve-resume-refusal` state and how to clear it.
- `v2/docs/v1-behaviors.md` — record the changed `run list` / `run wait` projection.

## Prerequisites

- Plan after `run-resume-returns-admission-refusal` merges.
- The daemon records a structural resume refusal (verbatim reason) on the run when `run resume` is refused by an admission gate.
