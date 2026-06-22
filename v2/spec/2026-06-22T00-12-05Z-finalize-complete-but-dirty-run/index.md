# Finalize complete-but-dirty runs; make idle-kill safe and universal

Harness spec (jarvis repo). Two finish-line gaps wasted finished/near-finished runs (#335 hand-finalized; #339 lost ~30 min). Fix both with machinery that already exists, and first make the idle watchdog safe enough to default on.

Sequenced: 00 calibrates the idle watchdog (file-activity liveness) so 01 can safely default it on; 03 reuses 00's extracted helper across every agent phase. 02 is independent.

- [ ] [00 - Idle watchdog: file-activity liveness + reusable arm helper](./00-idle-watchdog-file-activity.md)
- [ ] [01 - Default the idle watchdog on](./01-idle-watchdog-default-on.md)
- [ ] [02 - Harness commits a complete-but-dirty worktree](./02-commit-complete-but-dirty.md)
- [ ] [03 - Idle watchdog covers review, shrink, and plan phases](./03-idle-watchdog-all-phases.md)
