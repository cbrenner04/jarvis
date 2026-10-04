---
name: v2-ready-gate-runs-full-tier
---

# v2's completion gate runs the full ready tier (check, typecheck, tests, lint:md)

`v2/src/execution/ready-finalize.ts` spawns `bun run ready` via
`realAsyncSubprocessRunner.runAsync` without setting `JARVIS_READY_TIER` in the child's env, so
`scripts/ready.ts`'s `parseReadyTier` falls through to whatever `JARVIS_READY_TIER` the *parent*
process already has in its environment. `parseReadyTier` defaults to `"full"` only when the var
is truly unset; if the invoking process (or something upstream of it) has `JARVIS_READY_TIER=fast`
set — e.g. left over from a scoped test run — that value is inherited unmodified, silently
downgrading the v2 gate to typecheck + tests only. Biome `check` and `lint:md` never run, so a v2
run reports `completed` on a tree CI then rejects for format/lint. Observed 2026-07-13, run
`3c9536a9`, PR #1484: format error introduced by the run's own commit, gate green, CI red a
minute later, manual `bun run fix` to recover.

Behavior: the v2 ready gate always runs the same `full` tier v1's patch completion runs,
regardless of any `JARVIS_READY_TIER` inherited from the parent process. A lint or format
regression fails the gate, so the run does not report `completed` and the draft PR is not
flipped to ready.

## Decisions

- Fix is an env override, not a missing default: `ready-finalize.ts`'s `defaultRunReadyGate` must
  pass `JARVIS_READY_TIER: "full"` explicitly in the child process env for the `bun run ready`
  spawn, overriding (not merely supplementing) any `JARVIS_READY_TIER` already present in
  `process.env`. Do not change `parseReadyTier`'s default in `ready.ts` — it is already correct;
  other callers relying on ambient/unset behavior are out of scope and untested here.
- Gate failure keeps existing v2 failure semantics (`ready_finalize_failed`); this intent adds
  no new failure kind. Rules out inventing a lint-specific outcome.

## Prerequisites

## Out of scope

- Making `ready` sandbox-aware.
- v2 `triage --merge` support.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — v2's gate covers lint/format; drop the "run
  `bun run ready` yourself after a v2 implement run" stopgap.
- `v2/docs/v1-behaviors.md` if it records the gate tier difference.
