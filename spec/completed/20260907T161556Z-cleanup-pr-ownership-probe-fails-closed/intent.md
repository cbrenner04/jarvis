---
name: cleanup-pr-ownership-probe-fails-closed
---

# Cleanup PR ownership probes fail closed

## Prerequisites

## Module-boundary surface

- CLI cleanup admission in `v2/src/commands/cleanup.ts`

## Problem

- `gateOnOpenPrs` converts a failed `gh pr list` call into an empty result, so `--abandon` and stale-workspace reset can treat unknown PR ownership as permission to retire a branch.

## Behavior

- Cleanup PR ownership probing distinguishes `gh` failure from a confirmed zero-open-PR result.
- `--abandon` and stale-workspace reset refuse before mutation when PR ownership is unknown and name `gh` reachability plus sandbox-safe recovery.
- Confirmed zero-open-PR branches retain current cleanup and abandonment behavior.

## Decision ledger

- Represent failed PR inspection as an explicit unknown outcome at the ownership gate; rules out sharing a value with confirmed zero open PRs.
- Refuse every cleanup path that can retire work when ownership is unknown; rules out probe failure widening destructive permission.
- Name `gh` reachability and retry outside the agent sandbox in refusal text; rules out presenting an inconclusive probe as branch state.
- Preserve the existing fail-closed merged-worktree and merged-ref cleanup policy; rules out opposite policies for the same `gh` failure in one command.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` proves a thrown `gh pr list` probe produces an unknown ownership outcome distinct from a confirmed empty list; it fails against the pre-fix `catch { openPrs = [] }` path.
- [ ] `v2/src/commands/cleanup.test.ts` proves `--abandon` exits nonzero without prompting or changing the worktree, local branch, remote branch, or PR when `gh pr list` fails; stderr names `gh` reachability and sandbox recovery, and the test fails against the pre-fix silent pass.
- [ ] `v2/src/commands/cleanup.test.ts` proves stale-workspace reset refuses without teardown when the PR probe fails; it fails against the pre-fix permissive fallback.
- [ ] `v2/src/commands/cleanup.test.ts` proves a confirmed zero-open-PR branch still follows its existing reset and abandonment paths.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — add fail-closed `--abandon` and stale-reset behavior for unreachable `gh`, including the sandboxed-caller recovery.
- `v2/docs/v1-behaviors.md` — record unknown PR ownership as a pre-mutation cleanup refusal.
