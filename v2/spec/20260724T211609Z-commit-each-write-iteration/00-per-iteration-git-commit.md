# 00 - Git-commit each changed write-loop iteration

## Problem

`executeWriteLoop` commits SQLite boundaries per iteration but calls
`createCompletionCommitter()` only on terminal `complete` (and resume publication).
Agent file changes from `progress` iterations stay uncommitted until settlement, so
kill or daemon reconciliation on the same branch can discard in-flight edits.
`resetStaleWorkspace` on a later implement re-run still drops the branch regardless.
v1 patch mode commits WIP progress per iteration; v2 regressed.

## Decisions

- Scope: git-backed loops with `publishCompletion !== false`; only settled `progress`
  outcomes — not `blocked`, `contract_miss`, `iteration_timeout`, or other terminal paths.
- Hook order on `progress`: after step settle → iteration git commit (when materialized) →
  `store.commitCompletionBoundary` → post-settle `signal.aborted` short-circuit (and pause
  boundary) — rules out committing after abort skip or after SQLite boundary only.
- Invoke the injected `completionCommitter` (default `createCompletionCommitter`) only when
  the committer's isolated index `tree` differs from `HEAD^{tree}` (same materialization rule
  as `completion-commit.ts`) — rules out a parallel `git commit` helper and rules out
  empty iteration commits.
- Iteration commit failure on `progress` fails closed: run stops `failed` with
  `iteration_commit_failed` (or equivalent resumable outcome), loop does not continue —
  rules out log-and-continue that leaves dirty work uncommitted.
- Each iteration commit call must finish the committer pending-file lifecycle (no orphan
  `jarvis-completion-pending.json`); crash mid-pending follows existing completion-commit
  retry semantics on the next committer invocation.
- `title`: settled step binding metadata `title`, else run creation title fallback used at
  terminal today.
- `agent`: `result.invocation.final?.binding.metadata?.agent`, trimmed; quota-fallback final
  binding wins; empty after trim is a committer error (same as terminal).
- `specPath`: `resolveSpecPath(worktree, expectedArtifactPath)` when that path exists in the
  worktree; else run `specPath` (index path for plan/draft when artifact does not resolve) —
  rules out always using the index path, which would break `pr-attribution` subspec filtering.
- Message body must include `Spec: <normalized path>` and `Jarvis-Agent:` via the committer;
  iteration index in subject deferred (v1 `commitWipProgress` reference only).
- Publication (`completionPublisher` / push+PR) stays on terminal `complete` only.
- `iteration_timeout` out of scope: no per-iteration git commit on timeout settle (v1
  checkpoint documented in `v1-behaviors.md`; v2 timeout remains SQLite-only until a follow-up).

## Tasks

- Add the iteration commit hook on the write-loop `progress` path only, at the hook order above.
- Wire `title`, `agent`, and `specPath` resolution from settled step result and run context.
- Ensure reprompt-only / advisory-only steps do not reach iteration commit without a materialized diff.
- Add regression tests with a real git worktree fixture and injected committer.

## Acceptance criteria

- [ ] A new `write-loop.test.ts` case drives multiple `progress` iterations that each
      write distinct tracked files and asserts one git commit per changed iteration on
      the run branch, each message containing `Jarvis-Agent:` and a `Spec:` line matching
      the resolved subspec path; it fails against the pre-fix code.
- [ ] A new `write-loop.test.ts` case runs a `progress` iteration that materializes no
      diff vs `HEAD` and asserts `git rev-list --count HEAD` is unchanged; inverting the
      `tree === baseTree` materialization guard causes an extra commit and fails.
- [ ] A new `write-loop.test.ts` case completes one changed `progress` iteration, then
      aborts before the next `iteration_started`, and asserts the branch still contains
      that iteration's commit; it fails against the pre-fix code.
- [ ] A new `write-loop.test.ts` case aborts immediately after a settled `progress` step
      that changed files (post-settle, pre-next-iteration) and asserts that iteration's
      commit is on the branch; skipping iteration commit before the abort short-circuit
      fails the test.
- [ ] A new `write-loop.test.ts` case forces the iteration committer to throw on `progress`
      and asserts the loop stops `failed` with `iteration_commit_failed` (or documented
      equivalent) without a further `progress` boundary; allowing the loop to continue fails.
- [ ] `write-loop-dirty-completion.sandbox-unrunnable.test.ts` stays green (terminal
      dirty-worktree `completion_commit_failed` unchanged by iteration commits).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-iteration commit timing, materialization no-op, `progress`-only
  scope, and `iteration_commit_failed` (terminal publication and operator recovery in 01).
