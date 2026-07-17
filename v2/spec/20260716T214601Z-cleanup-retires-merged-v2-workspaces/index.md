# Cleanup retires merged v2 workspaces

`jarvis cleanup` does not discover v2 worktrees under `~/.jarvis/worktrees/`, so merged workspaces
and local branches accumulate until the operator removes them by hand.

**This has been implemented and rejected four times** (#1672, #1675, #1682, #1686), every one with all
acceptance criteria ticked and a green gate. The failures all clustered in the **eligibility gate**
(merged-PR / live-run / daemon detection), where agents repeatedly shipped self-certifying tests —
mocks hard-coding `MERGED`, daemon failures read as permission, argv assertions that pass a broken
command. See `01-eligibility-gate.md` for the full autopsy.

Split so the safety-critical eligibility logic is its own small subspec whose entire purpose is
differential tests that a hard-coded stub cannot satisfy. Run in order — 02 depends on 00 and 01.

- [ ] [00 - Discover materialized worktrees](./00-discover-materialized-worktrees.md)
- [ ] [01 - Eligibility gate](./01-eligibility-gate.md)
- [ ] [02 - Cleanup command and dry-run](./02-cleanup-command-and-dry-run.md)
