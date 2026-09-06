# Pipeline resume owns the failed plan-lane preamble

- [x] [00 - Failed plan resume harness preamble](./00-failed-plan-resume-harness-preamble.md)
- [x] [01 - Failed plan resume staged-file paths](./01-failed-plan-resume-staged-file-paths.md)
- [ ] [02 - Failed plan resume disposition reporting](./02-failed-plan-resume-disposition-reporting.md)

Scope: failed plan-lane `pipeline resume` owns the operator preamble (stale-reset settlement, base alignment, reserved harness-blocker clearing, dispatch) without manual branch cleanup or blocker edits; refuses operator-authored blockers and non-harness dirty work before destructive retirement; prints resolved absolute staged-file paths in refusals; reports retired-and-rematerialized versus reused worktree disposition on success. Builds on prerequisite stale-reset auto-clear from `20260831T080500Z-pipeline-resume-auto-clears-blocked-plan-lane-dirt`.
