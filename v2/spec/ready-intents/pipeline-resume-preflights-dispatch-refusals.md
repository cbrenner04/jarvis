---
name: pipeline-resume-preflights-dispatch-refusals
---

# `pipeline resume` / `pipeline recover` refuse at admission what the detached re-dispatch would refuse

## Problem

`pipeline resume` exits 0 (admitted), then the detached re-dispatch refuses in preflight (e.g. `stale reuse refused`) and the stage settles `failed`, surfaced only as a `stage-failed` incident.

## Decisions

- Before returning `resumed`/`admitted`, `pipeline resume` / `pipeline recover` evaluate the same pre-dispatch refusals the continuation would hit: dirty worktree, lane not descended from base, unresolved `## Blocker`.
- A refusal known at admission exits non-zero with the verbatim reason on stderr, using the same structural-refusal response shape as `run resume`; no stage is dispatched.
- Reuse the existing preflight checks; do not change the gates.

## Acceptance criteria

- [ ] `pipeline resume` whose re-dispatch would be refused by each of dirty worktree, lane not descended from base, and unresolved `## Blocker` exits non-zero with that reason before returning `resumed`; fails against the pre-fix exit 0 followed by a `stage-failed` incident.
- [ ] `pipeline recover` whose re-dispatch would be refused by the dirty-worktree gate exits non-zero with that reason on stderr; fails against the pre-fix exit 0 followed by a `stage-failed` incident.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume/recover refusals print their reason and exit non-zero.
- `v2/docs/daemon-host.md` — pipeline admission returns pre-dispatch refusals to the caller.
- `v2/docs/v1-behaviors.md` — record the changed pipeline-resume admission behavior.

## Prerequisites

- Plan after `run-resume-returns-admission-refusal` merges.
- The daemon returns a typed structural admission refusal (verbatim reason) to the CLI, which exits non-zero with it on stderr.
