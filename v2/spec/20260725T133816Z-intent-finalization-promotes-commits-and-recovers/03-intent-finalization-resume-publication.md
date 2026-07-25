# 03 - Resume republishes a populated intent stage

## Problem

Once resume admits a populated-stage intent row (subspec 02), it must actually complete publication —
promote to `durableDir`, clean the verdict sidecars, commit, push, and open the draft PR — without
re-invoking split or review agents. A resume that admits the row and then no-ops is worse than a
refusal, because the operator is told recovery happened when it did not.

## Decisions

- Resume replays finalization and completion publication from the persisted workflow snapshot without
  re-entering the write loop or invoking split, critic, or actuator bindings; rules out `freshDispatch`
  review replay (same contract as existing `landing_failed` resume tests).
- When resume admits the row but completion-agent resolution fails, settle a visible landing/harness
  failure rather than returning the prior `invocation_failure` stub with no publication work;
  `nextAction: "resume"` must never pair with a no-op resume path.
- Author the publication tail as small named helpers — snapshot/step resolution, publication
  invocation, and settlement are separate units, each under the `noExcessiveCognitiveComplexity`
  limit of 24, with the pure parts unit tested directly. A prior attempt wrote
  `runIntentPublicationTail` as one function at complexity 41 and red-gated `bun run check`. Rules out
  one large tail function, and rules out raising the threshold or suppressing the rule.
- Give the daemon resume handler a named function rather than an inline `(async () => { … })()` block
  inside the handler body (the prior attempt's was complexity 27). Rules out growing the IIFE.
- Depends on subspec 02 (admission), which must merge first — same seam.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `"resumes intent finalization from a populated stage without review
      re-invocation"` drives an intent workflow to a finalization failure with staged files, runs
      daemon resume on the authoritative completion `runId`, and asserts `durableDir` publication,
      stage and verdict sidecar cleanup, commit, and the same push/PR publication hooks as git-enabled
      happy-path intent tests, with zero split/review agent invocations; fails against pre-fix code.
- [ ] The same test asserts resume does not set `freshDispatch` and does not mint a new review
      invocation; inverting `freshDispatch` replay fails the test.
- [ ] At least one path drives daemon resume through the **write-loop entry that actually calls**
      `resumePopulatedIntentPublication` (real, or a fake executor that invokes it). A second
      `executeWorkflow` call is not accepted as the primary republication proof.
- [ ] Resume that admits the row but cannot resolve a completion agent settles a named
      landing/harness failure, not a silent `invocation_failure` stub; inverting that guard fails a test.
- [ ] `run wait` / `list` report `completed` for that `runId` after successful republication.
- [ ] `bun run check` is green: no `noExcessiveCognitiveComplexity` violation in
      `v2/src/execution/workflow-runner.ts` or `v2/src/daemon/daemon.ts`, and no rule suppression or
      threshold change in `biome.json`.

## Documentation updates

- `v2/docs/workflow-runner.md` — resume/recovery semantics: which `runId` to resume after intent tail
  redirection; populated-stage finalization replay without review re-invocation.
- `v2/docs/operator-runbook.md` § Recovery — recovering an intent run that failed with a populated
  stage (`jarvis run resume <runId>`, prerequisites, expected artifacts).
- `v2/docs/v1-behaviors.md` — intent publication recovery behavior.
