---
name: mutation-verification-outlives-its-run
---

# An iteration timeout strands applied mutations, and the verifier keeps running after the run is terminal

**Absorbs `mutation-verification-artifact-reached-the-completion-commit` (2026-08-02):** the
committed-content check below is that seed's surviving requirement — PR #2314 shipped a mutation
present in `HEAD` while the working copy read correct, so any pre-commit check must read the
content being committed, not the working tree.

## Problem

The runbook says a `SIGKILL` mid-verification can leave a mutated production file on disk. The
real exposure is wider: an ordinary `iteration_timeout` does it too, and the verification keeps
going after the run has settled.

Observed 2026-08-02 on `20260802T075146Z-tui-dock-projection`, run `ee3b2cb9`
(`iteration_timeout`, `resumable: false`). Its worktree held finished, uncommitted subspec-00 work
plus **three** applied `@mutate` directives:

```text
if (false) {                     // was: if (![first, second].some((line) => line.content.includes(DOCK_CURSOR))) {
false ||                         // was: snapshot.pipelineId === state.selectedNodeId ||
const killable = false;          // was: const killable = selectedRun?.isLive === true && isActiveRunStatus(...)
```

They did not appear at once. The operator restored two, copied the file out, and the copy still
carried a third — because the scoped verification was **still applying and restoring directives in
that worktree minutes after the run row was terminal**. Salvaging required reversing every
directive mechanically rather than trusting any single read of the file.

Two distinct defects:

1. The scoped verification run has no timeout and is not wired to the run's abort signal (already
   named in the runbook), so a settled, killed, or timed-out run does not stop it.
2. Restoration is in-process only. When the loop settles out from under it, the mutated file stays,
   and `git add -A` in any later commit would ship it.

This is worse than a lost run: the surviving artifact is a **silent behavior change** in production
source that typechecks and often still passes most tests.

## Decisions

- Wire the scoped verification run to the run's `AbortSignal` and give it its own timeout — rules
  out verification that outlives the loop that started it.
- Restore from a snapshot taken **before** the first mutation, in a path that runs on abort and on
  throw, not only on the in-process happy path — rules out relying on the mutation loop reaching
  its own restore step.
- Before any completion commit, refuse when a directive's replacement text is present in a target
  file where its original is absent, checking the staged/committed content rather than the working
  copy — rules out `git add -A` shipping a stranded mutation, which is the failure that actually
  reaches `main`, and rules out the working-copy-only comparison that passed on PR #2314.
- Out of scope: the `iteration_timeout` non-resumability itself (seed
  `iteration-timeout-discards-completed-subspecs`), and directive syntax.

## Acceptance criteria

- [ ] Aborting a run mid-verification stops the scoped run and restores every mutated file; a test
      aborts during verification and asserts the file matches its pre-mutation bytes.
- [ ] A scoped verification run that exceeds its own timeout is terminated and its file restored,
      rather than blocking the step indefinitely.
- [ ] A verification that throws mid-directive restores the file; a regression covers the throw
      path distinctly from the abort path.
- [ ] The completion boundary refuses when a target file contains a directive's replacement text
      while missing its original, naming path and directive; a regression fails against the current
      committer. The check reads staged/committed content: a second regression covers a mutation
      present in `HEAD` but absent from the working copy.
- [ ] Mutation checkpoint: removing the pre-commit stranded-mutation check turns that refusal test
      RED, via a `// @mutate` directive in the pinning file.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — replace the `SIGKILL`-only caveat: any abnormal
  settle can strand a mutation, and the completion boundary now refuses one.

## Prerequisites

- `verifyMutationCheckpoints` and its scoped-run/restore path
  (`v2/src/execution/mutation-checkpoint-verifier.ts`)
- The write-loop completion committer (`git add -A` boundary)
