I've confirmed the defect. The idle poll keeps rescheduling after `agent.run` returns; on a successful (`ok`) result the same `try` runs post-processing — commits, push, and PR-body **sub-agents** that reuse `state.currentController` and reassign `watchdogPgid` but never pass `lastOutputAtMs`. With nothing resetting the idle clock, the timer can fire mid-post-processing and abort/kill legitimate in-flight work. The timer is only cleared in `finally`. This is a real regression, not a hypothetical.

## Verdict

### Required outcome

**The idle watchdog must stop being able to fire once the agent run has returned.** Today the self-rescheduling 100 ms idle poll stays armed through all post-agent post-processing (commit, push, PR-body sub-agents, ready gate), and the idle clock is never reset after the agent exits. Because that post-processing reuses the iteration `AbortController` and reassigns the watchdog pgid to PR-body sub-agents — without feeding the idle clock — an idle fire during this window aborts the controller a live sub-agent is listening on and signals a pgid that may now belong to a different (possibly recycled) process group. Any operator who sets `idleOutputTimeoutMs` shorter than their post-agent work (notably the ready gate) hits this.

What must be true:
- The idle timer is disarmed at the moment `agent.run` resolves/returns, before post-processing begins — not only in the trailing `finally`. The `finally` clear should remain as a backstop.
- As a consequence, the idle and wall-clock callbacks can no longer both fire across one iteration, so the shared SIGKILL kill-handle cannot be orphaned by a second fire. Confirm that double-fire window is closed by this fix (no separate change needed if disarm-on-return holds).

### Rationale

The intent's contract is that the idle abort *bounds the agent's idle stall* and composes with — does not fight — the existing kill path. Letting the watchdog reach past the agent's lifetime into harness post-processing violates that contract: it can kill the harness's own follow-on work and the wrong process group. The spec checklist said only "clear the idle timer in the existing `finally`," modeling the idle path on the benign wall-clock path; that equivalence is wrong for a short idle span, since the wall-clock bound is benign post-agent only because 30 min rarely elapses. Fixing the lifetime restores the intended "bound the agent, nothing else" semantics.

### Not required

- Emitting a `[watchdog]` line on the pre-spawn pgid-null path — the spec only promises skipping the group kill there, and this matches the wall-clock path's behavior. No action.
- Measuring idle from spawn vs. `armedAt` — the spec explicitly equates these; the gap is spawn latency and the direction is safe. No action.
- The `?? "?"` fallback on the idle-timeout log line is dead (that branch only runs when `idleOutputTimeoutMs` is set) but harmless — optional trivial cleanup, not required.