# Commit completed-run worktree changes

The v2 write loop durably records successful completion but leaves the external
worktree dirty. Add a runner-owned git boundary addressable by commit SHA.

## Decisions

- Standalone write owns its commit after its durable `complete` boundary; workflow owns one commit only after every step and hidden shrink completes — rules out committing an intermediate workflow write loop.
- Stage the whole completion snapshot with `git add -A`; a clean snapshot succeeds without a commit — rules out tracked-only staging, empty commits, or clean-tree failure.
- Capture the completion snapshot in an isolated index and persist a runner-owned pending record containing base HEAD, tree OID, message, and attribution before ref mutation — rules out absorbing later operator dirtiness or losing retry identity after a process failure.
- Build the recorded commit once and update the branch ref by compare-and-swap; retry recognizes the recorded commit/ref state and returns its SHA — rules out duplicate commits after success or an ambiguous crash.
- Bypass commit hooks for the harness completion commit — rules out hook mutation or failure that can consume, rewrite, or hide recoverable tracked or untracked content.
- Use subject `jarvis: complete run`, first body line `Spec: <owning completion WriteLoopInput.specPath>`, and trailer `Jarvis-Agent: <owning completion binding metadata.agent>` — rules out another workflow step's identity, prose-derived identity, model/binding IDs, or an attribution-invisible body.
- The owning completion binding is the final successful binding that contributed to the completed standalone write or workflow, including hidden shrink; missing/empty `metadata.agent` fails completion publication before git mutation — rules out ambiguous multi-binding attribution or malformed trailers.
- Keep git and pending-record execution injectable at the standalone/workflow runner boundary — rules out git side effects in `commitCompletionBoundary`, the orchestration store API, or host-agnostic step execution.
- A post-boundary git/attribution failure preserves SQLite `completed`, reports `completion_commit_failed`, and is retryable through `jarvis run resume <run-id>` — rules out rollback, durable-completed short-circuit, or contradictory success reporting.
- Foreground write exits `1` on `completion_commit_failed`; daemon `list` shows `completed` plus the retryable error, and `wait` returns that state/error and exits `1` until retry succeeds — rules out presenting an unpublished completion as success.
- Successful dirty completion exposes `commitSha` to the owning runner; clean completion exposes no SHA — rules out a commit boundary unavailable to later publication or telemetry consumers.
- Operate directly in the existing v2 external worktree — rules out porting v1 `.worktree/`, lock-exclusion, symlink, push, or PR behavior.
- Progress, pause, budget exhaustion, blocked, contract miss, invocation failure, kill, and abort never create a completion commit — rules out git boundaries for non-complete outcomes.

## Work

- Add the injectable, recoverable completion-commit operation and runner ownership rules.
- Expose commit success/failure through foreground and daemon results.
- Cover snapshots, attribution, ordering, retries, non-complete outcomes, and failures.
- Update the durable write lifecycle and scoped v1 parity catalog.

## Acceptance criteria

- [x] A dirty standalone write commits its completion snapshot only after its terminal SQLite boundary is durable; a workflow commits once only after all steps and hidden shrink complete.
- [x] The commit stages the whole captured worktree, has subject `jarvis: complete run`, first body line `Spec: <owning completion input specPath>`, and `Jarvis-Agent: <owning completion binding metadata.agent>` trailer.
- [x] Multiple contributing bindings attribute the commit to the final successful completion contributor, including shrink; missing/empty `metadata.agent` produces `completion_commit_failed` without git mutation.
- [x] A clean completed worktree succeeds without an empty commit or `commitSha`.
- [x] Progress, pause, budget exhaustion, blocked, contract miss, invocation failure, kill, and abort create no completion commit.
- [x] Staging, commit-object, ref-update, and process failures leave the captured tracked and untracked completion content recoverable and SQLite `completed` unchanged.
- [x] Completion commits bypass hooks; success leaves the captured completion snapshot clean while preserving later operator changes as dirtiness.
- [x] Retrying `jarvis run resume <run-id>` after partial or successful completion-commit work creates no duplicate, excludes later operator changes, and returns the original commit SHA when a commit exists.
- [x] A dirty successful completion returns `commitSha` to the owning runner.
- [x] Foreground completion-publication failure exits `1`; daemon `list` and `wait` retain `completed`, expose retryable `completion_commit_failed` with the resume action, and `wait` exits `1` until retry succeeds.
- [x] Git subprocess execution is injectable; the orchestration store API, `commitCompletionBoundary`, and host-agnostic step execution gain no git side effects.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/write-behavior.md` documents commit ownership/timing, snapshot and retry semantics, caller-visible failure, attribution, commit SHA, clean no-op, and external-worktree ownership.
- [x] `v2/docs/v1-behaviors.md` marks only whole-worktree staging, completion commit, and trailer mechanics as ported and names the unported subject, label selection, worktree lifecycle, push, and PR behavior.

## Documentation updates

- Update `v2/docs/write-behavior.md`.
- Update `v2/docs/v1-behaviors.md`.
