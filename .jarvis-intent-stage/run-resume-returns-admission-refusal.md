---
name: run-resume-returns-admission-refusal
---

# `run resume` returns its admission-gate refusal reason to the CLI

## Problem

A `run resume` refused by an admission gate (incomplete-re-run descendant check / `stale reuse refused`, dirty tree, landed-criteria drift) logs the reason only to `~/.jarvis/daemon-*.log`; the CLI fails with no actionable reason.

## Decisions

- The daemon resume handler returns the gate's refusal as a typed structural refusal (verbatim reason) in its response, and records it on the run so later projections can read it.
- CLI `run resume` exits non-zero with that verbatim reason on stderr.
- Refusals are classified structural (won't succeed re-issued as-is) vs transient; only structural refusals are recorded as blocking.
- Out of scope: changing the gates themselves.

## Acceptance criteria

- [ ] A `run resume` refused by the descendant / `stale reuse refused` gate exits non-zero with the daemon's refusal reason on stderr; regression fails against the pre-fix daemon-log-only path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — resume admission-gate refusals are returned to the caller, not only logged.
- `v2/docs/operator-runbook.md` — when resume "does nothing", read the CLI refusal reason, not the daemon log.
- `v2/docs/v1-behaviors.md` — record the changed resume-refusal behavior.

## Prerequisites
