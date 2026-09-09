# Exclude review verdicts from completion commits

## Problem

Completion commits stage the entire worktree, so an untracked review verdict can become durable output even though review landing already treats verdicts as transient artifacts.

## Decisions

- `completionStageArgs` always excludes a glob matching `verdict-*.md` at every depth — rules out call-site-specific verdict paths that miss stale or sibling verdicts.
- Verdict exclusion narrows the staging pathspec without removing tracked entries — rules out turning a poisoned repository's next completion commit into an unrequested deletion.
- `.gitignore` adds the review-verdict basename pattern as repository-local defense in depth — rules out relying only on completion-committer discipline in this repository.
- `excludeVerdictFromStaging` remains unchanged — rules out broadening this fix into review-landing lifecycle changes.
- `v2/docs/write-behavior.md` owns the completion-staging contract and the workflow-runner guide cross-links it — rules out retaining duplicate verdict-publication contracts that can drift.

## Tasks

- Update `v2/src/execution/completion-commit.ts` so every completion staging argument list excludes review verdict basenames at any depth while preserving the existing external-spec and materialized-symlink exclusions.
- Add real-Git regression coverage in `v2/src/execution/completion-commit.test.ts` for root and nested untracked verdicts plus an already-tracked verdict.
- Add the defense-in-depth ignore to `.gitignore`.
- Align the completion-commit contract in `v2/docs/write-behavior.md`.
- Replace the implement-review durable-verdict claim in `v2/docs/workflow-runner.md` with a cross-link to the completion-staging contract.
- Record the changed parity behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/execution/completion-commit.test.ts` test `completion commit omits an untracked review verdict` drives a real worktree without a verdict ignore, commits another change, and proves the commit tree excludes the root verdict; it fails against the pre-fix staging arguments.
- [ ] `v2/src/execution/completion-commit.test.ts` test `completion commit omits a nested review verdict` proves a verdict beneath a spec-tree directory is absent from the commit tree; it fails against the pre-fix staging arguments.
- [ ] `v2/src/execution/completion-commit.test.ts` test `an already-tracked review verdict survives the completion commit` proves narrowed staging retains the verdict entry already present at `HEAD`.
- [ ] `v2/src/execution/completion-commit.test.ts` tests covering the materialized node_modules exclusion stay green.
- [ ] `v2/src/execution/workflow-runner-resume.test.ts` verdict-exclusion tests stay green.
- [ ] `.gitignore` ignores the verdict-*.md basename pattern.
- [ ] `v2/docs/write-behavior.md` states that completion commits never stage review verdict files and do not delete verdict entries already tracked at `HEAD`.
- [ ] `v2/docs/workflow-runner.md` no longer describes implement review verdicts as committed durable output and cross-links the completion-staging contract.
- [ ] `v2/docs/v1-behaviors.md` records that completion commits exclude review verdict basenames at any depth without deleting tracked verdict entries.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document the unconditional completion-staging exclusion beside the materialized node_modules exclusion.
- `v2/docs/workflow-runner.md` — replace the obsolete durable-verdict claim with a cross-link to the canonical completion-staging contract.
- `v2/docs/v1-behaviors.md` — record the completion-commit behavior change against the parity baseline.
