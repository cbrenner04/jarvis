## Verdict — changes required before merge

### Must fix (can produce bad production outcomes)

1. **A resumed populated-stage publication must always settle terminally.** `runIntentResumeCommitAndPublish` sets the row `in-progress` and then awaits publication with only the structured `publication.failure` path handled; a thrown error (from title resolution, landed-file listing, uncommitted-path probing, or `publishWithReadyRepair` itself) escapes `resumePopulatedIntentPublication`, and the daemon handler has no catch. Outcome required: no resume path can leave the row non-terminal with an open attempt — every failure, including unexpected throws, settles through the same visible-failure path (`failed` status, named `error.reason`, `loop_finished`, trace). This is the exact "row lies / `run wait` hangs" class subspec 01 exists to eliminate.

2. **Resume must publish against a real base ref.** Review-debate rows persist `specRef: ""` (standard review persists the landing `baseRef`), and the resume context takes `baseRef` from `run.specRef` and feeds it to the committer and PR creation. Subspec 00 requires debate-last intents to reach the same completion tail, so this is reachable. Outcome required: the resumed base ref is the real one (persist it on debate rows, or source it from the sibling write row), and a regression covers resuming a **debate-last** intent row — currently no test exercises resume on a debate row.

3. **Resume must respect worktree ownership.** The intent-finalization branch in `resume` runs before the existing `checkWorktreeClaimed`/claim step and never claims, so republication can race a live run on the same worktree. Outcome required: this branch honors the same ownership contract as the write-loop resume branch.

4. **Resume failure must report an established resume error code, not `landing_failed`.** The daemon's error frames use a fixed vocabulary (`resume_unsupported`, `terminal_run`, …); introducing an ad-hoc code makes the operator-facing failure unclassifiable. Outcome required: use an existing code; the specific landing reason belongs in the message and in the row's `error.reason`.

5. **Close the leaked log sink** opened per populated-stage resume (every other sink open in `daemon.ts` closes).

6. **Empty-verdict commit attribution must name the agent that actually ran.** The tail falls back to `completionStep.agents[0]` — the *configured* first agent, which under cascade is not the one that produced the work, so the `Jarvis-Agent:` trailer is wrong. Outcome required: prefer the completion agent recorded on the write step's own durable row; fall back to configuration only as a last resort, and when no agent is resolvable the run must fail visibly rather than silently skipping publication (the same silent-skip shape subspec 00 targets).

### Should fix

7. **`intent_finalization` must be operator-readable or the docs must stop saying so.** `workflow-runner.md` and `v1-behaviors.md` describe `phase`/`branch`/`stopReason` as operator-readable, but the log-follow renderer has no case for the event, so `run log` shows nothing. Outcome required: render the event, or align the docs to "jsonl-only trace."

8. **Admission checks must not do filesystem work per row in `list`/`wait`.** The resumability predicate stats and reads the stage directory and does a sibling-row lookup for every row, and the entry-row path computes it twice. Outcome required: cheap in-memory predicates (failed status, review behavior, `failureKind: "landing"`) gate before any filesystem access, and one resolution is reused rather than recomputed.

9. **Fix the weak/vacuous tests.**
   - The daemon admission test asserts only inside `if (response.kind === "error")`, so it passes vacuously on success — and on that path it runs the real committer against a bare temp dir. It must assert the response shape unconditionally and inject the resume dependency seam.
   - `twoFileIntentWorkflow`'s `actuatorInvoked` parameter is dead; remove it.
   - Subspec 02's admission-inversion criterion asks that flipping the admission gate *also* break `"resumes intent finalization from a populated stage without review re-invocation"`. The empty-stage test does not demonstrate that link. Either establish it or correct the criterion's claimed status.

### Honesty corrections required

10. **Subspec 00's guard-inversion criterion is not satisfiable as ticked.** It requires the promotion-disabled proof to live inside `"promotes two staged intents through a full reviewed intent workflow"`, but no injectable promotion guard exists in the code, so nothing in the tree demonstrates it. Either expose the seam and prove it in that named test, or untick the criterion and state why.

11. **Subspec 01's empty-failed-row criterion closed without a behavior change.** `composeRunOperatorError` already terminated in a non-empty `harness_failure` for failed rows; the new test asserts pre-existing behavior against a hand-built record rather than the `list`/`wait` projection the criterion names as authoritative. Required: drive the assertion through the operator row projection (where masking by the unsupported-resume error or an omitted `error` field could still produce the observed empty row), and record explicitly that the production occurrence #8/#9 producer has not been located — do not present it as closed.

12. **Document the resume path's undocumented couplings**: `durableDir` is recovered solely from the sibling write row's `specPath`, and the stage directory is a hard-coded constant, because the workflow snapshot persists neither landing nor git-enablement. Required: state this dependency in `workflow-runner.md` (or persist landing in the snapshot), and either cheaply refuse admission for a non-git worktree or explicitly document git-disabled admission as an unguarded, out-of-scope boundary — the spec scoped it out, but the gate currently admits it silently.