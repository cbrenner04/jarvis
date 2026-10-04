## Verdict — two required outcomes

**1. The branch-refusal test must pin a reason the `pipeline_resume` RPC can actually return.**

`v2/src/commands/pipeline.test.ts` (`pipeline resume prints a branch-scoped refusal verbatim on stderr`) fabricates `reason: "status_not_awaiting"`. That string belongs to the approve/reject refusal union; `PipelineResumeRefusalReason` (`v2/src/daemon/pipeline-execution.ts:116-122`) never includes it. The CLI reads only `kind`/`reason`, so behavior is unaffected and the acceptance criterion still holds literally — but the test doubles as the contract record for this RPC, and it currently records a response the daemon cannot send. Replace the literal with a real branch-scoped resume refusal reason (e.g. `branch_awaiting_approval`), keeping the `branchKey`/`stageId` fields so the fixture matches the daemon's actual branch-arm shape. The criterion does not constrain the reason string, so this is spec-compatible.

**2. The two doc sentences about branch refusals must not imply the CLI prints branch or stage detail.**

The CLI prints the daemon `reason` and nothing else — `parsePipelineMutationOutcome` discards `branchKey`, `stageId`, and `status`. This is the spec's decision (the ledger says that detail lives *in the result object*), so the behavior is correct as shipped. But two doc lines lost that qualifier and now read as promises of printed output:

- `v2/docs/write-behavior.md:387` — "daemon `reason` verbatim on stderr, including branch-scoped refusals carrying `branchKey`/`stageId`" reads as though those fields are emitted.
- `v2/docs/operator-runbook.md:198` — "A refusal **naming** the branch's own `awaiting` gate" reads as though the operator learns which gate from the refusal. They don't; the runbook then tells them to approve or reject that gate, which needs a `<stage-id>` the output never gives.

Required outcome: both lines state plainly that the CLI emits the reason string only, and the runbook line tells the operator where to get the gate's stage ID (`pipeline list` / `pipeline wait` boundary JSON) before approving or rejecting. Keep it terse — a clause each, not new paragraphs. Do not change CLI output or extend the shared mutation-outcome type; surfacing branch detail would also change `approve`/`reject` and is out of this subspec's scope.

**No action on the rest.** The `Record<string, string>` param type under `exactOptionalPropertyTypes` already makes a stray `branchKey: undefined` a typecheck failure, so the unscoped-request invariant is guarded even though the assertion wouldn't catch it. The two-scenario arity test is forced by the spec's per-directive `@mutate` anchors on that one named test. The unquoted-empty-shell-variable hazard (an empty `$BRANCH` silently degrading to unscoped resume) is a genuine consequence of the optional-positional design the ledger chose deliberately; it belongs in a follow-up intent, not a post-implementation reversal of the command's public shape.