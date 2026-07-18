# Seed: agent "delete-must-go-red" regression tests inject the unit under test

## Problem

When a spec AC demands a regression test that "goes RED if <behavior X> is removed/changed", the
implementing agent repeatedly authors a test that injects the very dependency it should observe, so
the named mutation stays GREEN — the AC is satisfied on paper while the behavior is untested. A green
gate + ticked AC then certifies a vacuous test.

Observed 2026-07-18 across two re-runs of `daemon-status-reports-source-snapshot`:

- Attempt #1751: a CLI test stubbed `getDaemonStatus`'s return value, so the real
  `loadedRevision === currentRevision ? running : stale` comparison was never exercised — deleting the
  whole comparison block left all unit tests green.
- Attempt #1753: the lifetime-capture test drove the CLIENT `getDaemonStatus` with
  `getDaemonLoadedRevision` injected directly, asserting only that the current-rev resolver was called
  once — it never observed the DAEMON's startup capture, so the "daemon recomputes HEAD live" mutation
  (the exact one the AC named) stayed green.

Both survived the green gate and were caught only by adversarial mutation review (break the production
code, confirm a test goes red). This is the class [[implement-completion-requires-adversarial-mutation-verification]]
(#1706) targets — this seed is a concrete, repeated instance and an argument that the mutation-verify
step must actually PERFORM the named mutation, not trust the AC tick.

## Decisions

- The implement completion / verification path should, for an AC of the form "test goes red if X",
  actually apply mutation X and confirm a test fails — not accept a green suite + ticked box as proof.
- Guidance (prompt/rules): a regression test must exercise the real decision unit through its genuine
  seam (e.g. a fake transport), not inject the value the unit is supposed to compute/return.

## Acceptance criteria

- [ ] A vacuous "delete-must-go-red" test (one that injects the unit's own output) is caught before
      completion — either by an automated mutation-verify step or by a sharpened rule the agent
      follows, demonstrated on a regression fixture.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — the inject-the-unit-under-test anti-pattern and the real-seam rule.
