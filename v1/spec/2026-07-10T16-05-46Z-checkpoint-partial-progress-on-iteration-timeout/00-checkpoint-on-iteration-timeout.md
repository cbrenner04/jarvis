# Commit uncommitted edits as a WIP checkpoint on iteration-timeout

When the `aborted: iteration-timeout` branch in `v1/src/modes/patch/iteration.ts`
(exit 8) fires, any agent edits still in the worktree are lost to the next
iteration because nothing commits them. Checkpoint them instead.

## Decisions

- Scope is the iteration-timeout branch only (`aborted: iteration-timeout`,
  around `v1/src/modes/patch/iteration.ts:915`) — not idle-timeout or
  run-timeout, and not the `agent-error` exit-3 path, which already commits
  partial progress.
- Gate the checkpoint on `gitEnabled && !specIsExternal` (the same condition
  `hasUntrackedMutations` already negates) — external/no-commit runs keep
  relying on `no-commit-delta.ts`'s reset instead.
- Detect "uncommitted edits present" via staged status after `git add -A`
  (mirrors `commitWipProgress`'s existing `ops.hasStagedChanges` check); commit
  only when there's something staged.
- The checkpoint commit message is a distinct WIP variant that does not
  reference acceptance criteria (e.g. `WIP: checkpoint (iteration-timeout)` +
  agent trailer) — separate from `commitWipProgress`, whose message format
  implies AC-tracked progress.
- No AC or index checkbox is touched by this commit.
- Commit failure is best-effort: log to stderr and still return exit 8 (same
  posture as the existing `commitLockfileChanges` failure handling) — a
  checkpoint-commit error must not mask the timeout as a harder failure.

## Task checklist

- [ ] Add a checkpoint-commit path fired from the `aborted: iteration-timeout`
      branch, gated on `gitEnabled && !specIsExternal`.
- [ ] Commit only when `git add -A` produces staged changes; no-op otherwise.
- [ ] Commit message carries no AC/completion claim and includes the agent
      attribution trailer.
- [ ] Commit failure is caught, logged to stderr, and does not change the
      exit-8 return.

## Acceptance criteria

- [ ] A `git: true`, non-external-spec run whose agent leaves uncommitted
      tracked edits at iteration-timeout has those edits committed to the
      worktree branch before the run exits 8.
- [ ] The checkpoint commit does not tick any acceptance criteria in the
      active subspec and does not modify `index.md`.
- [ ] A `git: false` (no-commit) or external-spec run behaves unchanged at
      iteration-timeout — no checkpoint commit attempted, existing
      `no-commit-delta.ts` reset still applies on the next invocation.
- [ ] An iteration-timeout with no uncommitted changes (agent made no edits,
      or edits were already committed) exits 8 with no new commit created.

## Documentation updates

- `v1/docs/run-loop.md` § "Stop conditions and exit codes": note the exit-8
  row now commits a WIP checkpoint of uncommitted tracked edits (when
  `git: true` and the spec isn't external) before returning.
- `v1/docs/operator-runbook.md` § "Manual-finalize recovery (last-resort
  path)": update the idle/iteration-timeout guidance so it no longer implies
  the operator must hand-reconcile uncommitted work accumulated across
  timeouts — a checkpoint commit now preserves it automatically.
- `v2/docs/v1-behaviors.md`: record that iteration-timeout (exit 8) commits a
  WIP checkpoint of uncommitted tracked edits, scoped to
  `git: true` + non-external-spec runs.
