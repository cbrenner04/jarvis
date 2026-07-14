---
name: resume-of-a-killed-run-has-no-bindings
---

# `run resume` on a killed or failed run always fails instantly with `no_binding`

`resumeHandler` (`v2/src/daemon/daemon.ts:969`) builds the `WriteLoopInput` for a non-paused,
non-awaiting-human resume like this:

```ts
const input: WriteLoopInput = {
  worktree: { projectRoot: run.worktreePath, projectName: run.project, branchName: run.branch, baseRef: run.specRef },
  specPath: run.specPath,
  stepRules: "",              // These should be reconstructed from the calling context
  expectedArtifactPath: "",   // These should be reconstructed from the calling context
  bindings: [],
};
spawnWriteLoop(key, runId, run.worktreePath, input);
return { kind: "response", result: { ok: true } };
```

`bindings: []`, with a comment conceding the reconstruction was never written. `runStep` gets an
empty binding list, `executeWithQuotaFallback` returns `final === null`, and the run dies
`invocation_failure` / `no_binding` before invoking any agent. The RPC still answers `{ ok: true }`
and the CLI prints `resumed <id>`, so the operator is told it worked.

Observed 2026-07-14: two `implement` runs killed by a daemon restart mid-write-step were resumed
per the runbook. Both went `failed` / `no_binding` in **32 ms**, zero agent invocations, remediation
`fix_config` — pointing the operator at a config that is not the problem.

**The fix already exists, thirty lines up.** `resumePausedRun` (`daemon.ts:833`) reconstructs
bindings correctly from the run's `WorkflowSnapshot`:

```ts
bindings = resolveInvocationBindings(
  resolveExecutableRole(snapshotStep.role), snapshotStep.agents, snapshotStep.agentModelConfig, createResolvedAgentBinding,
);
```

`WorkflowSnapshotStep` was designed for exactly this — its doc comment says write-step config
(`stepRules`, `expectedArtifactPath`, `agents`, `agentModelConfig`) "is carried here too so a later
`revise` can rebuild that step's `WriteLoopInput` without a live reference to the authoring
`WorkflowStep`" (`v2/src/persistence/state-store.ts:44`). The killed/failed path just doesn't read it.

## Why this is worse than one broken command

`run list` marks these rows `resumable: true` with remediation `resume`. The runbook prescribes
resume as the recovery for daemon-restart orphans and for `completion_commit_failed`. So the
harness's own advertised recovery path is the one that cannot work — and it composes with
`daemon-restart-kills-in-flight-runs`: a merge bounces the daemon, the bounce kills every in-flight
run, and the resume that is supposed to rescue them fails in 32 ms.

## Decisions

- The killed/failed resume path reconstructs `bindings`, `stepRules`, and `expectedArtifactPath`
  from the run's `WorkflowSnapshot` step, reusing `resumePausedRun`'s logic rather than duplicating
  it. Rules out leaving two divergent resume paths.
- A run whose snapshot cannot supply those fields is **not** advertised as resumable: `run list` /
  `run wait` report `resumable: false` for it, instead of offering a remediation that cannot run.
  Rules out today's `{ ok: true }` over a doomed spawn.
- A resume that cannot proceed fails at the RPC with a named error, not as a fake run failure
  32 ms later.
- Rules out: `no_binding` continuing to recommend `fix_config` when the config is fine.

## Prerequisites

- None. `WorkflowSnapshot` already persists every field required.

## Out of scope

- The `awaiting-human` and `revising` resume paths — both already work.
- Whether a daemon restart should kill runs at all (`daemon-restart-kills-in-flight-runs`).

## Documentation updates

- `v2/docs/daemon-host.md` — the resume contract, and which statuses are genuinely resumable.
- `v2/docs/operator-runbook.md` § Recovery — "Orphaned non-terminal runs after daemon restart" and
  "Publication / completion failures" both tell the operator to resume; both are currently wrong.
