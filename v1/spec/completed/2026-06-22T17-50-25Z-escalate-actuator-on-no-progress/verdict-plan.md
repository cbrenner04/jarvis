## Verdict — Refinements Required

The spec's core design (reuse `activeAgents.shift()` + retry, mirror quota fallback, treat `agentOrder` as a cheap→strong ladder) is sound and consistent with the intent. But the draft makes a false claim about an existing test and leaves several sibling side-effects of the no-progress block unscoped. The following must be addressed.

### Must fix (correctness defects)

1. **The "stays green" preservation claim is false — remove it and re-scope the affected tests.** The cited `run.test.ts` no-progress tests run with the default 3-entry `agentOrder` and synthesize real codex/cursor agents, so under the new behavior claude's no-progress will shift and retry — the assertions on exit code 4 and single agent invocation will *break*, not stay green. This is the paraphrase-instead-of-cite error the spec guidance warns against. The spec must: (a) drop the "stays green" framing from AC #3 and the checklist; (b) state that those tests must be *modified* to pin `agentOrder` to a single `claude` entry to preserve the single-rung exit-4 case; (c) rewrite AC #3 as a single-entry-order behavior ("a single-rung `agentOrder` exits 4 on first no-progress"); (d) require a *new* multi-rung test for the escalation path.

2. **Scope the terminal "made no progress; stopping" line and bounded-tail output to the exhausted path.** The spec scopes only the unticked-criteria diagnostic to the terminal exit, but the same no-progress block emits a "stopping" message and a bounded-tail line that run before it and assert terminal wording (pinned by an existing test). On an *advance*, "stopping" is misleading. Add an explicit decision: on advance, these lines must be suppressed/reworded so only the terminal exhaustion path reports stopping. Without this the operator sees "stopping" on a step that continues.

### Must state explicitly (defensible, but non-obvious)

3. **Run-wide stickiness.** `activeAgents` is run-wide and never restored, so escalation persists for the rest of the run, not "per spec." The "at most once per spec" wording is imprecise. State that the advance is run-wide (the actuator stays escalated for subsequent subspecs), and note this matches existing quota-fallback semantics. Do not add restoration logic — that contradicts the reuse-the-mechanism decision.

4. **Shared ladder across both signals.** Quota fallback and no-progress shift the same `activeAgents`. Interleaved signals (quota on one rung, no-progress on the next) consume the same finite ladder. State this in one line so the interaction is explicit.

5. **`maxIterations` interaction.** Advance does `state.iteration += 1; continue`, so escalation rungs count toward the iteration cap; the cap can pre-empt ladder exhaustion. Correct the "exit 4 only when `activeAgents` is empty" wording to acknowledge the cap, consistent with quota fallback.

6. **Pin the telemetry row kind.** The advancing iteration's distinct `exitReason` (e.g. `no-progress-fallback`) must be emitted on a non-terminal `kind: "ok"` row (matching the existing terminal no-progress and `criteria-progress` advance rows), not a quota-flavored kind. Pin this.

### Optional tightenings (low priority)

7. Tighten the escalation-line AC to assert content (e.g. mentions no-progress/escalation), not merely "distinct from the quota line," so a near-identical line can't pass.
8. Note out-of-scope: ready-gate fix-up no-progress does not escalate (the block is fix-up-guarded) — pre-empts re-litigation.
9. Have the new multi-rung test assert the retried iteration targets the *same* subspec, so AC #1's "same subspec" promise is actually verified.

### Rationale

Items 1–2 are genuine spec defects: a false test-preservation claim and unscoped terminal-wording side-effects in the shared block — both would mislead the implementer into shipping wrong behavior or a broken build. Items 3–6 are load-bearing interactions a competent implementer could resolve differently; the intent's "mirror quota fallback" choice resolves them, but the consequences (run-wide stickiness, shared ladder, cap pre-emption, row kind) are non-obvious and must be recorded per the ledger discipline. Items 7–9 close untested-claim gaps cheaply.