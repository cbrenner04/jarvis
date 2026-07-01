## Verdict — shrink actuator idle ladder escalation

Core escalation mechanics, completion-pipeline exit `8` short-circuit, primary durable docs (`agents.md`, `quota-signals.md`, `run-loop.md`, `v1-behaviors.md` ~61/245/315), and run-level terminal-idle coverage are in place. The branch is not merge-ready until the gaps below are closed.

### Required outcomes

1. **Prove partial-edit retention on non-final idle escalation.** Acceptance criteria require stalled-rung shrink edits to remain in the worktree when advancing to the next `reviewActuator` rung. Automated coverage must demonstrate that: a rung writes allowlisted shrink edits, idles, escalates, and those edits are still present when the later rung runs. Without this, the retention AC is asserted but unenforced.

2. **Prove terminal idle reverts shrink edits.** Acceptance criteria require final-rung idle to revert shrink changes before exit `8`. Automated coverage must assert worktree/HEAD state matches `preShrinkHead` after terminal idle (not only exit code and telemetry). Without this, the revert AC is asserted but unenforced.

3. **Align shrink idle detection with patch implementation and review actuator.** Idle-timeout escalation must trigger only when the classified result is an error whose stderr includes `aborted: idle-timeout`, matching the existing guards in those phases. Shrink must not match idle solely on stderr substring. This closes a defensive parity gap without changing current behavior for real idle aborts.

4. **Reconcile `v2/docs/v1-behaviors.md` post-completion shrink subsection (~107–108).** Those bullets still describe a single shrink invocation and unconditional silent discard on failure. They contradict the updated ~61 bullet (multi-rung idle/quota ladder) and the new terminal-idle exit `8` contract. Update them so the durable behavior catalog is internally consistent: multi-rung `reviewActuator` walk for idle (and quota), partial retention on non-final idle, terminal idle revert + exit `8`, and unchanged silent discard only for non-terminal non-idle failures that do not elevate exit code.

5. **Update `runPatchShrinkPhase` public docstring.** It still documents one invocation and silent discard on all failures. It must accurately describe the multi-rung idle/quota ladder, non-elevating non-terminal idle escalation, and terminal idle throwing `ShrinkTerminalError` (exit `8`) consumed by the completion pipeline.

### Not required in this pass

- Run-level escalate-then-success → exit `0` (task checklist marked optional; shrink-unit escalate coverage plus cited preservation tests suffice).
- Shared idle-escalation helper extraction (explicitly deferred in spec).
- `shrink-timeout` telemetry `exitReason: "timeout"` documentation or normalization (pre-existing wall-abort path; out of slice scope).
- `run_terminal` / `iteration.ts` comment staleness (pre-existing; unrelated to shrink idle escalation).
- Stronger `idleOutputTimeoutMs: 0` or escalate-completion harness-line assertions beyond spec AC (“does not idle-escalate”).
