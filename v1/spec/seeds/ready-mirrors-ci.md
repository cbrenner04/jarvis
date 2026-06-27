# `bun run ready` mirrors CI exactly (no hidden autofix in the gate)

## Problem

`bun run ready` mutates as a side effect of gating: its lint tier runs
`check:fix:unsafe` (autofix) then `check`. So `ready` passes on a tree the autofix
silently repaired in-place, while CI — which runs `bun install --frozen-lockfile`
then strict `bun run check` (no autofix) on the *committed* tree — fails on the
unrepaired code. Local green ≠ CI green.

This bit hard on 2026-06-27: a pre-existing unused-binding + a non-null assertion
were masked by `ready`'s autofix, so main sat red on CI undetected; and hand
integration-merges that ran `ready` (autofixing) then pushed *without committing
the autofix* shipped red. The operator then hand-diagnosed CI logs to recover —
exactly the manual work guardrails should make impossible.

## Direction (owner-specified)

Make `ready` a **pure verification** that matches CI, and move mutation out of it:

- `ready` runs the same gates CI runs, on the committed tree, mutating nothing:
  `bun install --frozen-lockfile`, strict `bun run check` (no `:fix`), `typecheck`,
  tests, `lint:md`. If `ready` is green, CI is green — that is the invariant.
- `check:fix:unsafe` becomes a **separate pre-`ready` step** (e.g. `bun run fix`),
  run *before* gating, and **its output must be committed** before `ready`.
- Jarvis's completion pipeline bakes the order in: **fix → commit the fix → strict
  gate**. It must never push a tree that the gate hasn't seen — no autofix applied
  after the commit it gates, no autofix left uncommitted.

Net: there is no path where a local gate passes but CI fails on lint/format/install,
and no path where an agent or operator pushes un-fixed code.

## Out of scope

- The `lint:md`-in-CI gap (separate `merge-on-green-gate` thread) — though once
  `ready` and the gated merge both enforce CI parity, that caveat can retire too.

## Documentation updates

- `v1/docs/operator-runbook.md` — replace the "check:fix leaves residual issues /
  run sandbox-off" gate notes with the fix→commit→strict-gate flow; **delete** the
  verbalized "remember to commit autofix after a hand merge" caveat once this ships
  (the guardrail replaces it).
- `v2/docs/v1-behaviors.md` — record the `ready` = strict-CI-parity behavior and the
  separate fix step.
