## Verdict

Uphold two of the three findings; the third is rejected on the evidence.

### 1. Fix: daemon hang when the linked implement step's first pass is an empty or already-complete index

When `implement` is launched as workflow step 0 and the linked index has zero unchecked (or already-checked) subspecs, the routing-failure path returns a synthetic `"complete"` outcome with `runId: ""` without ever invoking the `onStepRunCreated` callback. The daemon's workflow-start RPC only resolves that callback for `stepIndex === 0` (or via a thrown error) — neither occurs here, so the start RPC promise hangs indefinitely and the caller never gets a response.

Required outcome: a workflow whose step 0 is a linked-implement step routing to `empty_index`/`already_complete` must still resolve the daemon's start RPC (e.g., by invoking `onStepRunCreated` for that step with an appropriate runId, or by having the daemon settle on a terminal outcome for step 0 through another path). This is a regression introduced by letting these routing outcomes reach dispatch instead of failing at build time (per spec 02's decision to skip rather than hard-fail), so the runtime must account for the case it now allows through.

### 2. Fix: malformed `implement` project-config shapes are not safely rejected

`machine-config-loader.ts` only guards against `implement === undefined`. It does not guard against `implement: null` (which throws a `TypeError` when indexed for `reviewPasses`) or `implement` being a non-object (e.g., an array), which silently passes through as `reviewPasses: 0` instead of surfacing a malformed-value error.

Required outcome: any non-object, non-undefined shape for `implement` (including `null` and arrays) must be rejected as an invalid config value at effective-count resolution, consistently with how `projects`/`project` shapes are already guarded elsewhere in this loader. This matches spec 00's requirement that a present-but-invalid `implement.reviewPasses` (including a malformed containing structure) fails at resolution rather than being silently coerced or ignored.

### Not upheld

The claim that the appended review can observe a stale branch diff (missing implement/shrink commits) does not hold: the completion commit is a synchronous `git update-ref`, and the workflow step loop is a sequential `await`-based loop that only advances to the `review-debate` step after both the implement write step and its shrink pass have completed (and committed). The review's branch-diff render runs a fresh `git diff` at that point, so it always sees the prior commits. No action required here.