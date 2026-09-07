# v1-behaviors PR ownership unknown

## Problem

`v2/docs/v1-behaviors.md` records v2 cleanup parity deltas including fail-closed open-PR and worktree ownership for archival, but not unknown PR ownership as a pre-mutation cleanup refusal on destructive paths.

## Decision ledger

- Extend the existing v2 cleanup / `--abandon` parity bullets rather than add a competing catalog entry; rules out duplicating the full operator runbook contract.
- Record unknown PR ownership refusal for `--abandon` and stale-workspace reset only; rules out claiming merged-worktree eligibility changed in this slice.

## Task checklist

- Update the v2 `--abandon` parity bullet (or adjacent cleanup refusal bullet) to state that unreachable `gh pr list` refuses before mutation with reachability/sandbox recovery text.
- Note the same unknown-ownership refusal on incomplete re-run stale reset.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records unknown PR ownership as a pre-mutation cleanup refusal on `--abandon` and stale-workspace reset when `gh pr list` fails.

## Documentation updates

- `v2/docs/v1-behaviors.md` — unknown PR ownership refusal on destructive cleanup paths.
