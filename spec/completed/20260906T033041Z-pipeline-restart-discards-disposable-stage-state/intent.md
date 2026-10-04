---
name: pipeline-restart-discards-disposable-stage-state
---

# Pipeline restart treats pre-landing stage state as disposable

## Prerequisites

- Shared stale-reset retirement refuses when a branch carries commits not on base with no associated PR and names the salvage path.
- Shared stale-reset permits disposable-lane rematerialization past descendant and landed-criteria refusals when the caller marks the lane never-landed.

## Problem

Restarting a pipeline lane refuses on stale worktrees and inherited draft-tree `## Blocker` notes for state the restart exists to replace — work that never landed (no PR, no unpushed real commits). The operator must hand-tear-down per lane even though `--reset-despite-*` deliberately does not cover operator-blocker or staleness gates.

## Decision ledger

- Pipeline resume/restart of a never-landed lane classifies the stage worktree and staged drafts as disposable, rematerializes from the current base, and discards inherited draft-tree `## Blocker` without flags; rules out pre-dispatch refusals over state the restart replaces.
- Operator `## Blocker` in a landed artifact (on base or a live PR) still blocks resume; a blocker confined to a discarded draft tree does not; rules out a dead attempt's blocker note permanently poisoning the lane.
- Unpushed commits with no PR refuse disposal and name the salvage path via shared stale-reset gates; rules out silently destroying an unlanded implementation.
- Default resume path performs disposal; no new CLI surface; rules out growing the `--reset-despite-*` family per gate.
- Disposable classification and git/PR retirement policy delegate to shared stale-reset; daemon admission only wires the marker and revises the staged operator-blocker guard; rules out duplicating git checks in `pipeline-execution.ts`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` test `pipeline resume rematerializes a never-landed lane with stale worktree and draft-tree operator blocker` drives resume on a failed plan lane whose worktree is not descended from base and whose `.jarvis-plan-stage/intent.md` carries an operator `## Blocker`, with no PR and no unpushed real commits, and asserts rematerialization and dispatch without flags; it fails against the current pre-dispatch operator-blocker and descendant refusals.
- [ ] `pipeline-execution.test.ts` test `pipeline resume refuses never-landed lane with unpushed commits and names salvage path` drives resume on a failed plan lane whose branch is ahead of base with no PR and asserts refusal without worktree retirement, naming salvage recovery; it fails against a path that rematerializes through unlanded commits.
- [ ] `pipeline-execution.test.ts` test `pipeline resume refuses operator blocker on landed staged intent` drives resume on a failed plan lane whose `.jarvis-plan-stage/intent.md` operator `## Blocker` is committed on base or associated with a live draft PR, and asserts refusal without rematerialization or dispatch; it fails against disposable rematerialization through landed blockers.
- [ ] `pipeline-execution.test.ts` — `failed plan resume preserves live worktree claim despite both reset overrides` stays green (reachable on main: parameterized guard at ~6417).
- [ ] `pipeline-execution.test.ts` — `failed plan resume refuses operator dirt outside harness draft stage and preserves worktree` stays green.
- [ ] `pipeline-execution.test.ts` — `failed plan resume preserves %s despite both reset overrides` drops never-landed `operator blocker`, `mixed blockers`, and `non-descendant HEAD` parameters; rematerialization ACs own those outcomes on disposable fixtures.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — restart disposal contract for never-landed lanes; retire per-lane manual-teardown guidance superseded by default resume.
- `v2/docs/pipeline-execution.md` — disposable-state boundary at restart; landed versus draft-tree operator `## Blocker` handling.
- `v2/docs/v1-behaviors.md` — record revised pipeline restart disposable-lane contract.
