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
- The finalize commit reuses run-completion's `git add -A` + the exact
  `completion-pipeline.ts` message — body `chore: complete-but-dirty commit`,
  trailer `Jarvis-Agent: completion-ready` — rules out an ad-hoc message, keeping
  PR attribution byte-identical to an auto-committed completion.
- `git add -A` captures all untracked + modified files including any unfolded WIP;
  no separate WIP-folding step — rules out a bespoke WIP path that could leave
  stashed/unfolded work uncommitted.
- `triageMarkReady` becomes `async` to await `ensureDraftPr` and the push seam,
  rather than wrapping the async calls behind a sync shim — rules out a
  fire-and-forget wrapper that would not surface PR-open/push failures.
- Ordering after the completeness check: commit + push the dirty tree first, then
  open the draft PR if absent, then gate, then ready — `ensureDraftPr` opens the PR
  against the pushed HEAD, so the tree must be committed first.
- The DRAFT-only guard fires only for an **existing** PR; the absent-PR branch
  skips it and goes to open — rules out rejecting a no-PR worktree as "not DRAFT".
- A push failure bails non-zero with the commit intact (no PR open, no gate, no
  flip) — rules out silent data-loss or proceeding to gate on an unpushed tree.

## Task checklist

- [ ] In `triageMarkReady` (`v1/src/commands/triage.ts`), reorder so the
  completeness check precedes side effects; refuse incomplete runs as re-runs.
- [ ] Make `isSpecComplete` read each linked subspec's `## Acceptance criteria`
  section directly (not the index linked-checkbox, which an exit-6 tree may leave
  unflipped) and judge completeness on the **non-human-only** ACs only — apply the
  existing human-only filter (`(Manual)`, `visual inspection only`, `no automated
  guard`) so a tree whose only unchecked ACs are human-only counts complete.
- [ ] When the branch has no PR, open a draft PR (reuse `ensureDraftPr`) instead of
  erroring `no PR found`; `triageMarkReady` becomes `async` to await it.
- [ ] Commit the dirty worktree (`git add -A`, reusing the completion-ready commit
  message/trailer) and push before gating; bail if still dirty after commit.
- [ ] Run the ready gate once on the committed tree; flip ready on green, leave
  draft on red.
- [ ] Add test seams (commit/push, PR-open) mirroring the existing `runGate`/
  `prReady`/`ghRunner` seams; cover the new paths in `v1/test/triage-command.test.ts`.
- [ ] Update docs (below).

## Acceptance criteria

- [x] `jarvis1 triage <worktree> --mark-ready` on a complete worktree (all
  non-human-only ACs checked) with uncommitted changes and an existing draft PR
  commits the outstanding work so the tree is clean, runs the ready gate once, and
  flips the PR to ready on green (exit 0).
- [x] When no PR exists for the branch, `--mark-ready` opens a draft PR before
  gating instead of refusing with `no PR found`.
- [x] On a complete, **clean** worktree with no PR, `--mark-ready` opens the draft
  PR, gates, and flips ready (exit 0) instead of erroring `no PR found`.
- [x] When any non-human-only acceptance criterion is unsatisfied, `--mark-ready`
  refuses with a message identifying the worktree as a re-run (not a finalize),
  performs no commit, opens no PR, and runs no gate, and exits non-zero.
- [x] A worktree whose only unchecked acceptance criteria are human-only (`(Manual)`,
  `visual inspection only`, `no automated guard`) is finalized rather than refused.
- [x] The finalize commit captures untracked and modified files (`git add -A`) so the
  tree is clean before the gate; if the tree is still dirty after the commit, the PR
  is left draft and the command exits non-zero.
- [x] A failed ready gate leaves the PR draft (not flipped) and exits non-zero.
- [x] A push failure after the finalize commit exits non-zero, opens no PR, and
  runs no gate, leaving the commit intact.
- [x] `v1/test/triage-command.test.ts` stays green — the existing live-run-lock
  refusal and the DRAFT-only guard for an existing PR are preserved.

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
