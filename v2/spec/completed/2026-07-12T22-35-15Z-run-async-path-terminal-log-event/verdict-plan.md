## Verdict — refinement required

The design (settle in the rejection path before `finally`, guard on terminal status, best-effort demote + append) is sound, and the subspec is correctly sized — do not split it. But the decision record has holes that would let a plausible implementation pass review while missing the acceptance criteria. Refine as follows.

### Required refinements

1. **Name which producer emits the workflow-path record.** There are already two things that could append `run_execution_failed`: the existing spawn-boundary failure reporter (which discards its reason and emits a message-less record, pinned by `daemon-run-failure-capture.test.ts`) and a direct append through the workflow's open log sink. "Reuse the existing kind" reads as "reuse the existing reporter," which yields a record with no `message` and silently fails the first acceptance criterion. Add a decision stating explicitly which path the workflow failure uses and what happens to the spawn-boundary reporter — if it is left message-less, say so; if it is extended, the criterion requiring the existing test stay green must change accordingly. This is the single highest-risk gap.

2. **Define "terminal durable status" by naming the predicate and its consequences.** The spec leans on an undefined notion of terminal. The existing terminal predicate counts `paused` as terminal, so a workflow that rejects while a step is `paused` leaves the row `paused` with *no* terminal record — a real behavioral choice the spec currently makes by accident. Cite the predicate the implementation must use and state the `paused` outcome (and, symmetrically, that non-terminal states like `queued`/`revising` do get demoted). Either outcome is defensible; leaving it unstated is not.

3. **Pin the ordering: demote, then append, then release liveness/close the sink.** "Best-effort, neither blocks the other" is incompatible with the criterion that `wait` observes `runStatus: "failed"` — `wait` wakes on the terminal log record, so an append that lands before the status commit lets a waiter read a pre-demotion status. Keep the best-effort fault isolation (each side wrapped independently, neither aborting cleanup); replace the free ordering with a fixed one.

4. **Cover the no-log-sink case.** The log sink is absent when logs are not configured. Every acceptance criterion currently presumes a sink exists. State that durable demotion still runs and the append is skipped when there is no sink.

5. **Rule out cancellation being reported as harness failure.** Kill/abort-originated rejections must not produce a `run_execution_failed` record. The terminal-status guard is what protects this (the kill path lands `killed` durably first), so make that ordering dependency an explicit decision rather than an inherited assumption — and if the ordering is not actually guaranteed, name it as a defect in scope rather than relying on it.

6. **Say how a non-`Error` rejection becomes a message.** One clause reusing the existing `err instanceof Error ? err.message : String(err)` coercion. No length cap — bounding the field is invented precision with no consumer.

7. **Add a task that verifies the best-effort isolation criterion.** The criterion requiring worktree ownership release even when demotion or the append throws has no verifying task. Add fault-injection coverage for it.

8. **Move the write-loop coverage claim into Decisions with a citation.** "The write-loop path is already covered" is load-bearing — it is the reason this is one subspec and not two — and it currently sits in Problem prose. State it as a decision citing the write-loop spawn catch (durable demotion + awaited failure reporter), and state that the queued-promotion and resume paths route through that same catch, so a reader can tell no third path is being ignored.

### Rationale

Items 1–3 are the ones that produce a passing-looking implementation that misses stated acceptance criteria; the rest close design-record gaps that force the implementer to re-derive, or guess at, choices the spec should own. All are decisions where a competent implementer would plausibly choose differently and the difference is observable — exactly the bar for a ledger entry. No new scope is added: the failure kind, the best-effort posture, and the exclusion of a process-level rejection handler all stand as drafted.