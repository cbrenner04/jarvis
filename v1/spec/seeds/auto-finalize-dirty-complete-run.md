# Auto-finalize a complete-but-dirty run instead of manual operator finalize

A patch run can finish with the implementation effectively complete but exit
**dirty-worktree (exit 6)** — a WIP commit holding most criteria, plus
uncommitted changes from the last iteration, and no PR opened. Today the operator
hand-finalizes: commit the dirty work, integration-merge `main` (the branch is
usually behind), re-run `bun run ready` sandbox-off on the merged tree, tick the
manual ACs, push, open the PR, admin-merge. That whole sequence is manual — the
north-star gap (observed finalizing the intent-autofix spec, run exit 6 at 9/11).

Desired: a jarvis command finalizes a complete-or-near-complete dirty run rather
than the operator doing it by hand. Prefer folding into an existing flow (a `run`
resume, or `triage <worktree> --mark-ready`) over a new subcommand. For a run
whose worktree is dirty but whose non-human ACs are satisfied, it should commit
the outstanding work, ensure the draft PR exists, run the gate once, and ready on
green — leaving only the human-only/manual ACs and the diff review to the
operator. A genuinely incomplete run (unsatisfied non-human ACs) is out of scope —
that's a re-run, not a finalize.

Integration-merge of an advanced `main` and conflict resolution can stay out of
scope for a first cut (report "behind base, resolve then re-invoke") — see
[ready-flip-confirms-base-current] / worktree-branches-off-fresh-base for the
base-currency thread.
