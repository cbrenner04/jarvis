# The v2 ready gate omits lint/format, so runs complete green over a red CI

A v2 workflow run reports `completed` on a tree that CI immediately rejects. The gate it
runs does not include `bun run check` (biome) or `lint:md`, which are exactly the checks CI
fails on.

## Problem

Observed 2026-07-13, run `3c9536a9` (`implement` preset, spec
`20260713T183302Z-intent-review-prompts-render`, PR #1484):

- The run's own commit introduced a biome **format** error (a multi-line import biome wants
  collapsed).
- The run reported `outcomeKind: done`, `runStatus: completed`, `loop_finished: complete`.
  No gate failure, no `ready_finalize_failed`, nothing in the run log.
- **CI went red on that exact format error**, ~1 minute after the run declared success.
- Recovery was a manual `bun run fix` + commit + push by the operator.

The mechanism is in `scripts/ready.ts`:

- **`full` tier** (line 229) runs `check` → `typecheck` → tests → `lint:md`.
- **Non-`full` tier** (line 221) runs **only** `typecheck` and tests.

`v2/src/execution/ready-finalize.ts:36` invokes `bun run ready` with **no tier argument**, so
v2 gets the reduced tier: no biome, no markdown lint. A format or lint regression cannot fail
a v2 run's gate. v1's patch completion runs the shared `full` gate; v2 does not.

This is the concrete mechanism behind the existing v1 seed `local-gate-green-while-ci-red` —
the gate is supposed to make CI a formality, and for v2 it structurally cannot.

It compounds `triage-blind-to-v2-worktree-home`: v2 PRs also can't be merged through
`triage --merge` (which *would* run the `full` gate), so **both** gates that catch lint are
bypassed for v2 work, and raw `gh pr merge --admin` is the only path left.

## Decisions

- **v2's completion gate runs the same `full` tier v1 runs** — `check`, `typecheck`, tests,
  `lint:md`. Rules out a v2-specific reduced gate; a gate that omits the checks CI enforces
  is not a gate.
- **A run must not report `completed` over a red gate.** Mirrors the v1 rule in
  `run-cannot-report-complete-over-red-gate`.
- Prefer passing the tier explicitly at the `bun run ready` call site over changing
  `ready.ts`'s default — the default's other callers are out of scope and untested here.

## Prerequisites

- None.

## Out of scope

- Making `ready` sandbox-aware (`sandbox-aware-ready`).

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — v2's gate covers lint/format; drop the
  "run `bun run ready` yourself after a v2 implement run" stopgap once this ships.
