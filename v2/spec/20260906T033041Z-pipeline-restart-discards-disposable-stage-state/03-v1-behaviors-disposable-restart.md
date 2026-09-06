# v1-behaviors disposable restart

## Problem

`v2/docs/v1-behaviors.md` records failed-plan resume preamble behavior but still lists operator blockers, non-descendant `HEAD`, and landed-criteria drift as unconditional refusals without the never-landed disposable restart contract.

## Decision ledger

- Revise the existing failed-plan resume bullet to record disposable never-landed rematerialization, draft-tree operator-blocker discard, and preserved landed-blocker / unlanded-commits refusals; rules out silent v1-parity baseline rot on a behavior change.

## Task checklist

- Update the `Resuming a failed pipeline plan stage` bullet in `v2/docs/v1-behaviors.md` to match the disposable restart contract landed in subspec 00 and documented in subspecs 01–02.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records the revised pipeline restart disposable-lane contract (never-landed rematerialization, draft-tree operator-blocker discard, landed-blocker and unlanded-commits refusals, preserved live-claim and operator-dirt gates).

## Documentation updates

- `v2/docs/v1-behaviors.md` — record revised pipeline restart disposable-lane contract.
