# 01 — Implement `Landed elsewhere` report

## Problem

Implement (non-`plan/*`) worktrees whose spec landed via another PR stay ineligible for merged retirement and are dropped silently from bulk cleanup, so the operator must discover them manually.

## Decision ledger

- Non-`plan/*` branches never gain automatic bulk retirement from this spec; rules out auto-removing implement lanes when only the spec is on `completed/`.
- Report when the branch has no OPEN PR, merged authority failed, subsumed plan authority does not apply, and `resolveMergedWorktreeSpecIndexPath` (same durable-run walk as merged dirty retirement) resolves a spec whose tree exists under `<targetDir>/completed/` on the repository default branch at `HEAD`; OPEN PR → no line (rules out nagging active lanes).
- Stdout line format: `Landed elsewhere: <worktree path> — <reason>; run jarvis cleanup --abandon <branch> --discard-unlanded after verifying` (rules out removing the worktree in dry-run or apply).
- `--abandon` unlanded-commit guards stay unchanged; rules out bypassing `abandonUnlandedWorkRefusal` via bulk cleanup.

## Work

- During worktree discovery, classify ineligible non-`plan/*` worktrees that match the landed-elsewhere predicate and print the line; do not add them to retirement candidates.
- Keep daemon-unreachable reporting separate and fail-closed as today.

## Acceptance criteria

- [ ] `cleanup.test.ts`: an implement worktree with a CLOSED PR and its spec under `completed/` on the default branch prints the `Landed elsewhere` line including `jarvis cleanup --abandon <branch> --discard-unlanded` and is not removed in dry-run or apply; fails against the pre-fix baseline.
- [ ] `cleanup.test.ts`: the same lane shape with an OPEN PR prints no `Landed elsewhere` line.

## Documentation updates

- Deferred to [03-documentation.md](./03-documentation.md).
