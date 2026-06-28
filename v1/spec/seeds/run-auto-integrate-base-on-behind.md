# Auto-integrate base at final ready when branch is behind base

When a concurrent merge advances `main` during a long `jarvis run`, the run reaches
completion with criteria done but blocks the ready-flip:
`ready flip blocked: branch <b> does not contain base main; PR stays draft`. The
operator must then hand-run the [Integration-merge-then-retest pattern] (merge
`origin/main`, re-gate, push, ready, merge) — a recurring manual intervention for the
common **conflict-free** case. Observed 2026-06-28 on PR #773: behind-base by one
config/docs-only commit, clean merge, then a stray Biome `organizeImports` dirt
(introduced by the review-actuator after the fix step) reached CI because the
final fix+ready never ran post-block.

## Decisions

- On `behind base` at the final ready-flip, attempt a **clean** `git merge origin/<base>`
  in the run worktree; rules out leaving every conflict-free behind-base run for manual
  integration.
- If the merge is conflict-free: re-run the completion gate (fix + ready) on the merged
  tree, then flip ready on green; rules out flipping without re-gating the integrated tree
  and rules out the post-actuator lint dirt reaching CI.
- If the merge conflicts (or the re-gate fails): abort the merge, leave the PR draft with
  the current `does not contain base` message; rules out auto-resolving conflicts that
  need operator judgment.
- Keep the behavior inside the existing run completion flow; rules out a new subcommand.

## Documentation updates

- `v1/docs/operator-runbook.md` — note that conflict-free behind-base now auto-integrates;
  the manual Integration-merge-then-retest pattern remains for the conflict case.
- `v2/docs/v1-behaviors.md` — record the final-ready behind-base auto-integrate step in the
  gate ordering (per specs-update-v1-behaviors rule).
