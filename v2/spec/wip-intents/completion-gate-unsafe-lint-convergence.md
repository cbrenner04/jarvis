# Completion gate should converge on lint instead of forcing a hand-finalize

## Problem

The "complete-but-can't-converge" recovery the operator ran ~6× by hand (verify green → tick →
commit → `gh pr ready` → merge) was driven mostly by no-tick (#9) and the fix-up spin (#10),
which are now bounded. The residual forcing-function is lint: the ready gate runs **safe**
`check:fix`, which leaves `noImplicitAny` / `noExplicitAny` / unused-var fixes that only
`check:fix:unsafe` (or a hand edit) resolves. The later `check` step then fails red on those
residuals, the gate blocks a green spec, and the operator hand-finalizes. This bit E, #9, and is
the seed of #10's churn.

We don't want a new `jarvis finalize` command — we want the gate to converge on its own.

## Direction

Use what exists: have the gate's auto-fix step escalate beyond safe fixes so a green spec isn't
blocked by mechanically-fixable lint. Options (pick one, make it coherent):

- Run `check:fix:unsafe` in the gate's fix step (the commit-and-recheck path already commits
  `check:fix` output), or
- When safe `check:fix` leaves `check` red, surface the *exact* residual rule + file so the next
  iteration fixes it deterministically rather than the operator discovering it at merge.

Auto-applied unsafe fixes must still be committed and re-checked (the gate already does this for
safe fixes); a still-dirty/red tree after escalation stays red.

## Out of scope

- A standalone `finalize` command or any new human step — #9/#10/serial-retry plus this cover the
  cases that drove manual finalize.
- Changing what counts as "green" (tests/typecheck unchanged).

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the gate's lint-escalation/commit behavior.

## References

- `scripts/ready.ts` — `getReadyCommands`: `check:fix` (`:206`) then `check` (`:209`);
  `check:fix:unsafe` exists in `package.json` scripts.
- `v1/src/ready-gate.ts` — `:88` commits `chore: apply pre-ready check:fix` output and re-checks
  the worktree; this is where unsafe output would also be committed.
- `v2/spec/2026-06-20T22-01-19Z-completion-commit-checkfix-output-2/` (#323, #10) — the spin bound
  this complements.
