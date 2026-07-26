Checking a few code paths to validate the advocate’s highest-severity claims before issuing the verdict.
## Verdict: required spec refinements

### Authorization semantics (`list` vs kill)

- **Outcome:** Subspec 00 must state the operator-visible rule for when `jarvis run kill <runId>` succeeds on workflow-started runs, and tests must match that rule.
- **Rationale:** Kill is specified against a workflow row in `activeRuns`, while `list` marks `isLive` only when the durable row is `in-progress` and the id is in the live-run-id set. A step can remain in `activeRuns` after its durable row is no longer `in-progress`, so kill acceptance and `list` “live” can diverge unless the spec chooses alignment (e.g. require `in-progress` for kill) or documents intentional broader kill-by-step-id while the invocation is still open.

### Shared `AbortController` on all workflow `activeRuns` entries

- **Outcome:** Subspec 00 needs an acceptance criterion (or an unambiguous merge into the signal/kill AC) that the claim row and every `onStepRunCreated` row share one daemon-owned controller instance—not only that kill aborts something in tests.
- **Rationale:** Intent AC #1 is structural contract; tasks alone let an implementer satisfy kill/signal tests with controllers only on step rows.

### Settlement and rollup after kill

- **Outcome:** Subspec 00 must clarify durable outcomes for the killed step, sibling step rows, and the workflow entry row after kill (including how entry status is reported on `list`), and include at least one verifiable acceptance outcome for operator-visible rollup (e.g. entry reflects `killed` when the in-flight step is killed).
- **Rationale:** Intent requires `killed` on the targeted run and `isLive: false` after settlement; it does not spell out whether siblings stay unchanged, whether kill avoids whole-workflow `failed` settlement, or how `commitGuardedKill` interacts with already-terminal step rows. Without this, implementers may fight `settleFailedWorkflowRun` or mis-handle multi-step graphs.

### Publication / non-agent tail after the current step

- **Outcome:** Subspec 00 must bound what operator kill stops: whether abort is required to halt only the current agent-bearing step (with cleanup via existing `.finally` paths) or all remaining `executeWorkflow` work including publication/landing without an agent. If the latter is out of scope, say so explicitly and point to follow-up work—do not leave it implicit.
- **Rationale:** Intent ties abort to step `signal` injection; post-step work may not honor that signal. Silent assumption risks “kill succeeded” while durable work still runs.

### Enforceable tests and preservation anchors

- **Outcome:** Subspec 00 must name the existing `daemon-workflow-start.test.ts` cases that flip (especially live kill on a tracked step id) and preserve pause as `run_not_active`; the authorization “no stall heuristic” criterion must cite a concrete test or source guard (per spec guidance on guard inversion and refactor anchors); the write-loop preservation criterion should remain a cited test file.
- **Rationale:** Tasks say “replace/adjust” but no AC pins the `kill/pause reject a later step's runId…` test; the guard-inversion AC is otherwise unanchored; contradictory expectations could survive implementation.

### Implementation prerequisites / injection path

- **Outcome:** Subspec 00 tasks or prerequisites must note that daemon-side signal injection on workflow write steps is the path tests exercise (write-loop / `prepareWorkflowStep` propagation), not only generic `executeWorkflow` signal hooks.
- **Rationale:** Prerequisites cite line-level hooks but omit the spread path implementers must wire; detail buried only in intent prerequisites is easy to miss during 00-only runs.

### Decisions worth one explicit line each (00)

- **Outcome:** Document that `commitGuardedKill` on an already-completed durable row is expected to no-op while shared abort still stops the graph; claim row carries the shared controller for invocation lifetime (not an operator kill target id).
- **Rationale:** Reduces implementer churn on edge cases that mirror write-loop behavior.

### Operator docs subspec (01)

- **Outcome:** Add an acceptance criterion that `operator-runbook.md` no longer pairs “`daemon stop` refused for active runs” with “workflow `run kill` is impossible / ineffective” (gotcha list and § workflow kill reflect the new contract, including heading text that does not contradict body).
- **Rationale:** Intent explicitly removes that deadlock narrative; tasks mention pruning but nothing verifiable ensures the runbook fix lands.

### Explicit non-goals (brief, 00 Decisions)

- **Outcome:** State that pre–step-0 kill by claim id is out of scope (operator-facing id is step 0 after `start` returns); double-kill idempotency and kill-during-daemon-retire need not be new ACs unless you choose to document expected mirror of write-loop.
- **Rationale:** Closes narrow windows the review surfaced without expanding RPC scope.

---

**Overall:** The spec’s core approach (liveness-only kill authorization, shared daemon `AbortController`, signal injection, `killed` without worktree teardown, docs in 01) is fit to implement once the items above are reflected in subspec 00 and 01. No subspec split is required; refinements are clarifications, acceptance outcomes, and doc verification—not a reopening of stall/reap gating.