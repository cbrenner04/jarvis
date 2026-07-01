## Verdict — shrink actuator idle ladder escalation

**Approve direction.** The draft matches intent (same `reviewActuator` ladder, idle-fire only, `shrink:` stderr, terminal exit `8`, `iterationTimeoutMs` terminal). Gaps are binding and verification seams, not scope.

### Required refinements

1. **Completion-pipeline terminal binding** — Add an acceptance criterion that terminal shrink idle returns run exit `8` from the completion pipeline and review does not run. Today shrink failures are absorbed and review proceeds; “the run exits `8`” is not enforceable without this binding. Mirror review actuator’s phase-exit short-circuit, adapted for shrink’s position before review.

2. **Run-level automated guard** — Add a completion-path test (e.g. `run.test.ts` or equivalent) proving terminal shrink idle → exit `8` with review skipped; optionally escalate-then-success → exit `0`. Unit coverage on `runPatchShrinkPhase` alone cannot catch pipeline swallow.

3. **Shrink-phase propagation contract** — Pin in Decisions how terminal idle exit `8` crosses the shrink→pipeline boundary (return code vs typed throw) and how non-terminal escalation stays non-elevating. `runPatchShrinkPhase` is `Promise<void>` with a docstring that discards without elevating exit; intent’s terminal `8` needs an explicit observable seam.

4. **Terminal idle telemetry `kind`** — Pin terminal shrink idle row `kind: "error"` with `exitReason: "watchdog-idle-timeout"` (parity with current shrink rows and review actuator terminal idle). Non-terminal already pins `kind: "timeout"`; terminal AC names only `exitReason`.

5. **Partial edits on non-final stall** — Pin that non-terminal idle keeps partial shrink edits from the stalled rung in the worktree (no per-rung rollback to `preShrinkHead`); only terminal idle reverts. “Does not revert worktree changes” blocks full discard but leaves partial-edit retention ambiguous.

6. **Per-rung watchdog arms in tasks** — Echo the Decisions requirement that each re-spawn gets fresh idle watchdog and `iterationTimeoutMs` arms inside the per-rung loop. Current shrink arms wall-clock timeout outside the loop; task-only readers can miss this.

7. **Multi-rung test injection** — Adopt a `shrinkAgents[rungIndex]` parallel-array pattern (matching review’s `actuatorAgents`) in Decisions and tasks. `opts.agents` keyed by agent name cannot bind duplicate agents on two rungs.

8. **Single-rung preservation AC** — Cite `shrink.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in shrink phase"` with explicit expectations: terminal on only rung, no `watchdog-idle-timeout-fallback` row, no escalation stderr. Review idle spec uses the same pattern for single-rung terminal behavior.

9. **`run-loop.md` exit table** — Doc AC must name the exit `8` table row (~1010) and idle-output section (~1088), not prose-only updates. Both still describe shrink idle as unconditionally terminal with no cascade.

10. **`v2/docs/v1-behaviors.md` bullet pins** — Doc AC must name stale bullets to update: post-completion shrink consumption (~61), `idleOutputTimeoutMs` config row (~245), idle-watchdog section + v2-divergence line (~315–316). General “records shrink idle escalation” risks partial edits leaving contradictions (same failure mode as patch idle and review idle specs).

11. **`v1/docs/quota-signals.md`** — Add to documentation updates and AC. The `watchdog-idle-timeout` / `watchdog-idle-timeout-fallback` inventory still lists shrink as terminal-only (~176). Review idle spec updated this catalog; shrink escalation must reconcile it.

### Not required in this pass

- **Shared idle-escalation helper** — Already deferred in spec.
- **Quota+idle cross-signal AC** — Defer unless per-rung loop composition is unclear at implementation time.
- **Multi-stall-then-success test** — Optional; one-step escalate AC plus cited preservation tests suffice.
- **`v2/docs/invocation-liveness.md` as separate doc target** — Update via `v1-behaviors.md` v2-divergence bullet per one durable home.
- **`operator-runbook.md`** — No shrink-idle guidance to revise today.
- **Kill-path parity with review actuator** — Pre-existing asymmetry; escalation mechanics need not include pgid kill alignment.
- **`workflows.md`** — High-level shrink node has no idle-escalation detail to reconcile.
