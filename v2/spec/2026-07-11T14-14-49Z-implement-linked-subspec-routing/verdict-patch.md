I mistakenly invoked the wrong tool. Here is the actual verdict as required by the adjudicator instructions:

## Verdict: Return to actuator — required outcomes

The core per-iteration routing loop is not wired up. `buildImplementWorkflowSteps` (v2/src/execution/implement-workflow-steps.ts) calls `resolveActiveLinkedSubspec` exactly once, at workflow-build time, producing a single static `write` step with a fixed `expectedArtifactPath`. Nothing in `executeWorkflow`/`runWorkflowStep` (v2/src/execution/workflow-runner.ts) re-resolves the active linked subspec or re-invokes this builder after a step completes. `advanceLinkedSubspecCheckbox` and `findModifiedLinkedCheckbox` (v2/src/execution/linked-subspec-routing.ts) are exported and unit-tested but never called from `workflow-runner.ts`, `write-loop.ts`, or `implement-workflow-steps.ts` — confirmed by a repo-wide reference check. Shrink (`runShrinkAfterImplementComplete`) runs unconditionally after any completed `write`+`role: implement` step, without ever reading `routingResult.isTerminal`.

Required outcomes:

1. **Per-link progression must actually happen at runtime.** After a linked subspec's `write` step completes, the harness must re-resolve the next unchecked linked subspec and route the following iteration's prompt/completion-check to it, continuing until no unchecked linked item remains. Building one static step at launch and never revisiting routing does not satisfy this — the spec explicitly rules out "shrink or workflow completion after the first slice."

2. **Index checkbox advancement must be harness-owned and actually invoked.** `advanceLinkedSubspecCheckbox` must be called at the point a linked subspec's non-human-only acceptance criteria are verified complete, and `findModifiedLinkedCheckbox` must be called to detect/restore agent-authored edits to the index routing checklist (reporting `implement.index_routing_mutated` without advancing). Both currently exist only as tested-in-isolation helpers with no production call site.

3. **Shrink must be gated on terminal routing state.** Shrink should run only once, after the final linked subspec advances (`isTerminal` true) — not after every completed implement step regardless of remaining links.

4. **Coverage must prove the above end-to-end**, not just unit-test the helper functions in isolation: an integration-level test must drive a real multi-link index through more than one linked subspec via `run workflow implement`, showing routing advances, checkbox state updates, mutation protection engages, and shrink fires only at the terminal link.

Until these are wired in, the AC items claiming harness-owned index advancement, agent-mutation protection, and terminal-only shrink are not actually true of the running system and must not remain checked.