# Operator runbook pipeline reset overrides

## Problem

Operators reading `v2/docs/operator-runbook.md` have no pipeline resume/recover guidance for `--reset-despite-dirty` and `--reset-despite-landed-criteria`, so they cannot tell when pipeline recovery offers the same reset levers as standalone workflow re-runs.

## Decision ledger

- Document both flags on `pipeline resume` and `pipeline recover` in the existing incomplete re-run / pipeline recovery section; rules out a new standalone doc home.
- Resume docs state each flag skips only its matching shared stale-reset gate, name preserved refusals (live-held worktree, operator `## Blocker`, non-descendant `HEAD`), and note failed-plan redraft still auto-clears ordinary staged-tree dirt without flags; rules out implying recover runs stale reset.
- Recover docs state the flags forward for RPC parity only; rules out documenting recover-side worktree retirement.
- Cross-link the existing four-gate incomplete re-run preflight sequence rather than duplicating full gate prose; rules out a second copy of the standalone workflow gate table.

## Tasks

- Update `v2/docs/operator-runbook.md` with `pipeline resume` / `pipeline recover` flag forms, per-flag gate scope, preserved refusals, failed-plan auto-clear interaction, and a cross-link to incomplete re-run preflight gates.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` documents `pipeline resume` and `pipeline recover` `--reset-despite-dirty` / `--reset-despite-landed-criteria` (resume: force matching stale-reset gate skips when auto-clear or ordinary gates refuse; recover: RPC parity only); cross-links incomplete re-run preflight gates; fails against the pre-fix doc on main that documents pipeline workflow-stage re-dispatch without pipeline override flags.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume/recover override flags, per-flag scope, preserved refusals, failed-plan auto-clear note, recover RPC-parity note, cross-link to incomplete re-run preflight gates.
