# Harness commit entrypoints pin scope enforcement

## Problem

Scope logic centralized in `createCompletionCommitter` only protects production if every harness commit entrypoint uses that committer and the scope hook runs inside it; today all paths call `createCompletionCommitter()`, but nothing pins that each entrypoint still routes through the post-stage scope enforcement added in [00-completion-commit-run-scope.md](00-completion-commit-run-scope.md) — a future stub committer or bypass would silently drop the guard.

## Decisions

- One fake-git (injected `runGit`) test per entrypoint family, each asserting the shared scope-enforcement helper runs (observable via injected `runGit` on revert/index mutations or direct invocation when the helper is exported) — rules out a single `completion-commit.test.ts` case implying coverage of shrink, resume, write completion, and ready-gate repair without driving those call chains.
- Shrink and write completion/checkpoint pins live in `write-loop.test.ts`; resume-recovery pin in `workflow-runner-resume*.test.ts`; ready-gate repair re-commit pin in `write-loop.test.ts` (repair publish path) — rules out duplicating four full integration fixtures in `completion-commit.test.ts` alone.
- Each pin must use the production `createCompletionCommitter` factory with injected `runGit` (or call the same exported enforcement helper the factory invokes); a recording stub committer that never runs post-stage enforcement does not satisfy the pin — rules out tests that only assert a committer was called.

## Tasks

- Add shrink-entry fake-git pin (settled iteration / shrink step commit).
- Add write completion or checkpoint-entry fake-git pin (`commitSettledIteration` or terminal completion publish).
- Add resume-recovery commit-entry fake-git pin (`workflow-runner-resume.ts` completion tail).
- Add ready-gate repair re-commit fake-git pin (`publishWithReadyRepair` / `enforceRepairIterationFence` commit leg).

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` contains a fake-git test that drives shrink's harness commit through `createCompletionCommitter` with injected `runGit` and fails if post-stage scope enforcement is removed from that factory while the entrypoint remains wired; passes with production enforcement.
- [ ] `v2/src/execution/write-loop.test.ts` contains a fake-git test that drives write checkpoint or completion harness commit through the production committer factory with injected `runGit` and fails if post-stage scope enforcement is skipped; passes with production enforcement.
- [ ] `v2/src/execution/workflow-runner-resume.test.ts` or `workflow-runner-resume-review-dispatch.test.ts` contains a fake-git test that drives resume-recovery's harness commit through the production committer factory with injected `runGit` and fails if post-stage scope enforcement is skipped; passes with production enforcement.
- [ ] `v2/src/execution/write-loop.test.ts` contains a fake-git test that drives ready-gate repair re-commit through the production committer factory with injected `runGit` and fails if post-stage scope enforcement is skipped; passes with production enforcement.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None (behavior covered in [03-documentation-alignment.md](03-documentation-alignment.md)).
