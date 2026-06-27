---
name: finalize-dirty-complete-run
description: Auto-finalize a complete-but-dirty patch run (commit, ensure PR, gate, ready) instead of manual operator steps
---

# Finalize a complete-but-dirty run

A patch run that exits dirty-worktree (exit 6) with all non-human ACs satisfied
should be finalized by jarvis, not hand-finalized by the operator. Fold into the
existing `triage <worktree> --mark-ready` flow (which today handles only a clean,
complete worktree with an existing draft PR).

For such a worktree, finalize:

- Commits the outstanding uncommitted changes (and any unfolded WIP) so the tree is clean.
- Ensures the draft PR exists, opening it if absent.
- Runs the ready gate once on the committed tree.
- Flips the PR ready on green.

Leaves only human-only/manual ACs and the diff review for the operator.

Refuse a genuinely incomplete run (any non-human AC unsatisfied): report that this
is a re-run, not a finalize, and make no commits, no PR, no gate run.

## Prerequisites
