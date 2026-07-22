---
name: retire-the-dispatch-revision-guard
---

# Retire the dispatch revision guard

## Problem

- Once dispatch selects a daemon by executable digest, the revision-mismatch guard, its auto-bounce, and `--no-auto-bounce` guard against a condition that can no longer occur — while still refusing dispatch whenever runs are live.

## Outcome

- Revision-mismatch refusal, automatic bounce, and `--no-auto-bounce` are gone from dispatch and from CLI usage.
- Merging executable code no longer blocks dispatch, with or without live runs.

## Decisions

- Remove the guard rather than disable it; rules out dead compatibility machinery beside keyed routing.
- Remove `--no-auto-bounce` from parsing and usage text; rules out accepting a flag that no longer does anything.
- Retire the operator bounce ritual from the durable docs in the same change; rules out documentation that describes a removed mechanism.
- Keep daemon `stop`/`start` as explicit operator commands; rules out removing lifecycle control along with the guard.

## Acceptance criteria

- [ ] Dispatch after a merge that changes executable code proceeds without a bounce, including while runs are live.
- [ ] `--no-auto-bounce` is rejected as unknown and absent from usage output.
- [ ] No dispatch path performs a revision comparison or an automatic daemon restart.
- [ ] A regression test covers dispatch across an executable change with a live run, and fails against the pre-change guard.
- [ ] `jarvis daemon stop` and `jarvis daemon start` still work.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove bounce-after-merge operations and mismatch recovery.
- `v2/docs/first-workflow-walkthrough.md` — replace fixed-socket and manual-start examples.
- `v2/docs/v1-behaviors.md` — record keyed routing and the retired bounce behavior.

## Prerequisites

- Mutating dispatch starts or reuses the daemon keyed by the invoking executable digest.
