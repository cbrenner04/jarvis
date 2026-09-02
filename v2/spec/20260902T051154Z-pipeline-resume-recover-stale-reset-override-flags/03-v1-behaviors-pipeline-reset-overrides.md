# v1-behaviors pipeline reset overrides

## Problem

`v2/docs/v1-behaviors.md` records pipeline workflow-stage stale reset without pipeline CLI override flags, so the v1 parity baseline omits resume/recover parity with standalone workflow re-runs.

## Decision ledger

- Record pipeline resume/recover `--reset-despite-dirty` / `--reset-despite-landed-criteria` as v2 additive parity with standalone `plan`/`implement` re-runs; rules out claiming v1 had these flags.
- Correct the existing pipeline stale-reset bullet that states no pipeline override flags in this slice; rules out leaving contradictory baseline text.
- Recover entry notes RPC-forwarding-only semantics; rules out implying recover retires worktrees.

## Tasks

- Update the pipeline workflow-stage stale-reset and/or pipeline recovery bullets in `v2/docs/v1-behaviors.md` to record CLI override parity and recover forwarding-only behavior.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records pipeline resume/recover `--reset-despite-dirty` / `--reset-despite-landed-criteria` parity with standalone workflow re-runs and recover RPC-forwarding-only semantics; fails against the pre-fix baseline bullet on main that states no pipeline override flags.

## Documentation updates

- `v2/docs/v1-behaviors.md` — pipeline resume/recover override-flag parity; correct the no-override-flags pipeline stale-reset baseline.
