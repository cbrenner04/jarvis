---
name: cleanup-reclaims-terminal-worktrees
---

# Cleanup reclaims eligible terminal worktrees

## Prerequisites

- Dead keyed daemon generations expose their complete removable `.sock`, `.pid`, and `.log` set while live or ambiguously probed generations preserve the whole triplet.

## Module-boundary surface

- Cleanup eligibility and artifact discovery in `v2/src/commands/cleanup.ts` and `v2/src/commands/cleanup-artifacts.ts`.

## Problem

Cleanup retains worktrees claimed only by terminal runs, fails opaquely on redundant plan-stage criteria dirt, inspects non-spec or missing paths, scopes one detached owner across unrelated specs, and repeats skip lines.

## Behavior

- Cleanup retires merged worktrees when no non-terminal durable row or live daemon run claims them; redundant chained-implement criteria ticks do not block a merged plan worktree's retirement, while other dirt refuses with the dirty paths named.
- Stranded discovery ignores dot-directories, harness staging directories, and paths absent at report time; ownership and detached-worktree refusals are scoped to the artifact being decided; each skipped artifact appears once per invocation.
- Cleanup stages eligible completed specs for archival and applies the prerequisite daemon triplet classification in the same invocation.

## Decision ledger

- Only non-terminal durable rows or daemon-live rows retain `(project, branch)` ownership; rules out perpetual ownership by completed, failed, or killed rows.
- Force-remove a merged plan worktree only when every dirty path is criteria-tick drift already present on the merge base; rules out discarding unrelated operator changes under the redundant-tick exception.
- Refused dirty retirement names the dirty paths; rules out exposing only `Command failed: git worktree remove`.
- Exclude every dot-directory and recognized harness staging directory from spec discovery, then recheck path existence before reporting; rules out treating agent scratch state or vanished entries as artifacts.
- Key skip aggregation by canonical artifact identity and emit one final reason line; rules out duplicate output from pre-retirement and stranded passes.
- A detached or unresolved worktree blocks only an artifact it materially contains or durably identifies; rules out one worktree disabling repo-wide archival.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `terminal-only run claims do not retain merged worktrees` retires the worktree and stages its completed spec for archival; it fails against the pre-fix owns-forever behavior.
- [ ] `v2/src/commands/cleanup.test.ts` test `merged plan worktree with landed criteria-only dirt retires safely` proves redundant chained-implement ticks permit retirement, while a sibling fixture with unrelated dirt is preserved and reports its paths; it fails against the pre-fix raw `git worktree remove` error.
- [ ] `v2/src/commands/cleanup.test.ts` test `stranded discovery ignores non-spec and vanished paths` produces no skip lines for dot-directories, harness staging directories, or a candidate deleted before reporting; it fails against the pre-fix inspection output.
- [ ] `v2/src/commands/cleanup.test.ts` test `detached owner blocks only its own artifact` stages an unrelated completed spec for archival while preserving the owned spec; it fails against the pre-fix repo-wide ownership gate.
- [ ] `v2/src/commands/cleanup.test.ts` test `each skipped artifact is reported once` drives the pre-retirement and stranded passes over one identity and asserts one merged skip line; it fails against the pre-fix duplicate output.
- [ ] A cleanup regression fixture consumes the prerequisite daemon triplet classification so one invocation previews and applies all dead daemon companion removals; it fails against the pre-fix socket-only integration.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — terminal-claim reclamation, criteria-dirt retirement and refusal paths, artifact filtering/deduplication, spec-scoped ownership, and daemon companion integration.
- `v2/docs/v1-behaviors.md` — record the changed v2 cleanup behavior and v1 divergence.

## Primary implementation surface

v2/src/commands/cleanup.ts
