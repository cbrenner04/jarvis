# Auto-finalize complete-but-dirty via `triage --mark-ready`

## Problem

A patch run that exits `dirty-worktree` (exit 6) with every non-human-only
acceptance criterion already satisfied currently forces the operator to
hand-finalize: commit the leftover work, ensure/open the draft PR, re-run the
gate, then `gh pr ready`. `triage <worktree> --mark-ready` today only handles a
**clean** worktree that already has a draft PR — it errors `no PR found` when the
PR is absent and never commits a dirty tree, so the operator does that by hand
(`v1/docs/operator-runbook.md` "Complete-but-dirty run").

Fold that finalize into `--mark-ready`: for a complete worktree it commits the
outstanding work, ensures the draft PR, gates once, and flips ready on green —
leaving only human-only ACs and the diff review for the operator. A genuinely
incomplete run is refused as a re-run, with no side effects.

## Decisions

- Completeness is judged on **non-human-only acceptance criteria** of each linked
  subspec (and of a single-file spec), not on the index linked-checkbox alone — an
  exit-6 tree may carry uncommitted criteria ticks, so the working-tree ACs are the
  source of truth, not a possibly-unflipped index checkbox.
- The incompleteness refusal runs **before any side effect** (no commit, no PR
  open, no gate) — rules out opening a PR or committing on a tree that turns out to
  be a re-run.
- An existing PR must still be `DRAFT` (existing guard preserved); only an **absent**
  PR triggers open — rules out committing onto an already-ready, merged, or closed PR.
- The gate runs **once** with no fix-up loop — rules out re-entering the run-loop's
  red-retry/fix-up machinery; matches current `--mark-ready` single-gate semantics.
- The finalize commit reuses run-completion's `git add -A` + `Jarvis-Agent:
  completion-ready` trailer — rules out an ad-hoc commit message, keeping PR
  attribution identical to an auto-committed completion.

## Task checklist

- [ ] In `triageMarkReady` (`v1/src/commands/triage.ts`), reorder so the
  completeness check precedes side effects; refuse incomplete runs as re-runs.
- [ ] When the branch has no PR, open a draft PR (reuse `ensureDraftPr`) instead of
  erroring `no PR found`.
- [ ] Commit the dirty worktree (`git add -A`, reusing the completion-ready commit
  message/trailer) and push before gating; bail if still dirty after commit.
- [ ] Run the ready gate once on the committed tree; flip ready on green, leave
  draft on red.
- [ ] Add test seams (commit/push, PR-open) mirroring the existing `runGate`/
  `prReady`/`ghRunner` seams; cover the new paths in `v1/test/triage-command.test.ts`.
- [ ] Update docs (below).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree> --mark-ready` on a complete worktree (all
  non-human-only ACs checked) with uncommitted changes and an existing draft PR
  commits the outstanding work so the tree is clean, runs the ready gate once, and
  flips the PR to ready on green (exit 0).
- [ ] When no PR exists for the branch, `--mark-ready` opens a draft PR before
  gating instead of refusing with `no PR found`.
- [ ] When any non-human-only acceptance criterion is unsatisfied, `--mark-ready`
  refuses with a message identifying the worktree as a re-run (not a finalize),
  performs no commit, opens no PR, and runs no gate, and exits non-zero.
- [ ] A worktree whose only unchecked acceptance criteria are human-only (`(Manual)`,
  `visual inspection only`, `no automated guard`) is finalized rather than refused.
- [ ] The finalize commit captures untracked and modified files (`git add -A`) so the
  tree is clean before the gate; if the tree is still dirty after the commit, the PR
  is left draft and the command exits non-zero.
- [ ] A failed ready gate leaves the PR draft (not flipped) and exits non-zero; the
  existing live-run-lock refusal and the DRAFT-only guard for an existing PR are
  preserved — `v1/test/triage-command.test.ts` stays green.
- [ ] `v1/test/triage-command.test.ts` covers: finalize a dirty-but-complete worktree
  with an existing draft PR, open-PR-when-absent, refuse-incomplete with no side
  effects, and human-only ACs not blocking finalize.

## Documentation updates

- `v2/docs/v1-behaviors.md`: update the `--mark-ready` entry — it now finalizes a
  complete-but-dirty worktree (commit + ensure/open draft PR + single gate + ready),
  refuses genuinely-incomplete runs as re-runs with no side effects, and judges
  completeness on non-human-only ACs. (Required: changes existing v1 behavior.)
- `v1/docs/operator-runbook.md`: the "Complete-but-dirty run" recovery bullet now
  points at `jarvis1 triage <worktree> --mark-ready` auto-finalize instead of a
  manual commit.
- `v1/docs/run-loop.md`: the exit-6 and `--mark-ready` references reflect that
  `--mark-ready` commits a dirty tree and opens an absent PR during finalize.
