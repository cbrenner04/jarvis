## Verdict

One required outcome. The production seam (`iteration.ts`, `run.ts`) is correct and inert by default — that part of the spec is met. The defect is in the test wiring for the `watchdog_descendants_alive=true` case.

### Required outcomes

1. **Make the true-case injected process table fully synthetic — no read of real spawn state.** The injected provider for the grandchildren test currently gates its return on `existsSync`/`readFileSync` of the real `hanging-child.pid` artifact (`run.test.ts:4330–4347`): if the descendant hasn't spawned and flushed its pid file before the watchdog snapshot fires, it returns `[]`, the snapshot returns `false`, and the `watchdog_descendants_alive=true` assertion loses the race. This re-introduces exactly the spawn-timing axis the spec was authored to eliminate (Problem: "the snapshot still reads the real table"; AC #2: "no longer depend on real spawn/reap timing"; AC #5: structural determinism). 

   The provider receives `rootPid` precisely so it can **name a synthetic descendant of the dynamically-assigned root without observing the real one** (Decision #6's stated rationale). `snapshotWatchdogDescendantsAlive` only evaluates `collectSubtree(rootPid, procs).length > 0`, and `collectSubtree` matches descendants by ppid-link and shared pgid, excluding the root. So the provider must return a constant table such as `[{root}, {child with ppid=rootPid, pgid=rootPid}]` derived solely from the `rootPid` argument — no `existsSync`/`readFileSync`/`Number.isFinite`/try-catch, no disk read. After the fix the true-case `watchdog_descendants_alive=true` result must be a pure function of the injected table, independent of whether the real child has spawned.

   The real grandchild-spawn and real grandchild-kill assertions (`childAlive === false`, `elapsedMs <= 7200`, `watchdog_pgid` present, `last_output_age_ms=null`, `exit_reason: "watchdog-iteration-timeout"`) stay as-is — only the descendant-table source becomes synthetic.

### Notes (no action required)

- The `elapsedMs <= 7200` exposure on the true test is sanctioned residual scope (Decision #5 keeps 4000ms; the diagnosis Decision names elapsed as the *next* axis if green doesn't follow). Once outcome #1 lands, this reverts to the single acknowledged residual.
- The false-case provider (`() => []`) already meets determinism; its 1500ms timeout is harmless since it needs no live child.

### Optional cleanup (fold in if touching the file)

- `WatchdogListProcessesFn` (`run.ts:128–130`) inlines a structural duplicate of the exported `ProcInfo`. Reusing `(rootPid: number) => ProcInfo[]` is the drift-proof, #15-consistent choice. Low severity; non-blocking.