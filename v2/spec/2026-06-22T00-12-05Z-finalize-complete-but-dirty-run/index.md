# Finalize complete-but-dirty runs; make idle-kill safe and universal

Harness spec (jarvis repo). Two finish-line gaps wasted finished/near-finished runs (#335 hand-finalized; #339 lost ~30 min). Fix both with machinery that already exists, and first make the idle watchdog safe enough to default on.

Sequenced: 00 calibrates the idle watchdog (file-activity liveness) so 01 can safely default it on; 03 and 04 then reuse 00's extracted helper across the non-patch phases — these are the heaviest items, each needing per-phase output-activity plumbing into a distinct spawn binding, split along the patch/plan seam. 02 is independent.

- [ ] [00 - Idle watchdog: file-activity liveness + reusable arm helper](./00-idle-watchdog-file-activity.md)
- [ ] [01 - Default the idle watchdog on](./01-idle-watchdog-default-on.md)
- [ ] [02 - Harness commits a complete-but-dirty worktree](./02-commit-complete-but-dirty.md)
- [ ] [03 - Idle watchdog covers patch review and shrink phases](./03-idle-watchdog-patch-phases.md)
- [ ] [04 - Idle watchdog covers plan draft, review, and verdict-actuator phases](./04-idle-watchdog-plan-phases.md)
