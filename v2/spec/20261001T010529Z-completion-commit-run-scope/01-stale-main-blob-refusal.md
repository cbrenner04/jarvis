# Stale-main blob refusal on completion staging

## Problem

Reachable on main today: a lane branched from stale local `baseRef` can stage file content that matches the blob at `baseRef` for a path while integration default-branch `main` already carries a different blob; pre-fix `createCompletionCommitter` commits that regression when the path is otherwise in the run diff (`bf1e5cbc6` in the intent evidence).

## Decisions

- After run-scope allowset enforcement from [00-completion-commit-run-scope.md](00-completion-commit-run-scope.md), apply a stale-main check per remaining staged path with no history walk: refuse when staged blob equals `git show baseRef:path` and differs from `git show integrationMainRef:path` — rules out blaming only out-of-diff paths while allowing in-diff stale blobs.
- Refusal uses the same revert + `commit_scope_violation` path as out-of-scope violations in 00 (with the same `logSink`+`runId` gate) — rules out a separate terminal error class for stale-main only.
- Callers pass `integrationMainRef` on `CompletionCommitInput` (resolved at existing harness commit call sites from the same default-branch / integration tip ref those paths already use for lane sanity checks); the committer does not invent a third ref name — rules out hardcoding `origin/main` inside `completion-commit.ts` without caller context.
- Deferred to first consumer: staged path absent at `baseRef` (new file vs deleted-on-base) — pin whether stale-main applies or the path is skipped when `git show baseRef:path` fails.
- Deferred to first consumer: staged path absent at `integrationMainRef` — pin refuse vs skip when integration tip has no blob for the path.
- Deferred to first consumer: `git show` failures other than missing path (I/O, ambiguous ref) — pin fail-closed vs skip for that path.

## Tasks

- Implement blob comparison on the scoped index using injected `runGit` for happy-path fixtures (path exists at both refs).
- Thread `integrationMainRef` from write-loop, workflow-runner, and workflow-runner-resume committer call sites.
- Add stale-main regression in `completion-commit.test.ts` (branch `baseRef` behind updated `main`, in-diff path reset to `baseRef` content).

## Acceptance criteria

- [ ] `v2/src/execution/completion-commit.test.ts` stages an in-run-diff path whose content matches the `baseRef` blob while integration `main` differs; the path is reverted, named in `commit_scope_violation` when `logSink` and `runId` are provided, and excluded from the commit; it fails against the pre-fix committer reachable in `completion-commit.ts`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [03-documentation-alignment.md](03-documentation-alignment.md).
