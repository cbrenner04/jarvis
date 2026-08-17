# Publish plan output without staging sidecars

## Problem

Plan completion can copy stage-only verdict artifacts into a branch commit, making a corrected recovery look clean only in the final tree while leaving leaked sidecars in published history.

## Decisions

- No commit published by an ordinary or recovered plan workflow may contain `.jarvis-plan-stage/`, `verdict-plan.md`, verdict ownership files, backups, or any other staging sidecar. This applies to every workflow-created commit in the published branch range, not merely the final tree.
- The shared landing and completion-publication tail stages only durable `index.md`, sanitized `intent.md`, and index-linked numbered subspecs, plus deletion of the consumed ready-intent. It never stages sidecars from the worktree.
- Recovery and ordinary plan publication use the same durable-file allowlist and commit construction; no recovery-only publication path is introduced.

## Tasks

- Restrict shared landing and completion publication to durable plan files and ready-intent consumption.
- Ensure the workflow-created commit range contains no staging sidecar, including verdict artifacts, while retaining end-to-end recovered publication coverage.
- Update the publication documentation and run the required v2 verification.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` test `recovered plan publication commits only durable output` uses a real Git fixture and proves the final commit contains corrected durable plan files and ready-intent deletion, while every workflow-created commit from the fixture base contains no `.jarvis-plan-stage/`, `verdict-plan.md`, verdict owner, backup, or other staging sidecar; its unique source directives invert every sidecar-publication guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `recovered plan publication commits only durable output`; Mutation checkpoint:
- [ ] `v2/src/execution/publication-landing.test.ts` test `plan landing excludes review sidecars` proves ordinary and recovered plan landing share the durable-file allowlist and excludes every staging sidecar from both the landing result and every workflow-created commit; it fails against the pre-fix verdict-copy behavior and its unique source directives invert every durable-file allowlist guard. `v2/src/execution/publication-landing.test.ts` — `plan landing excludes review sidecars`; Mutation checkpoint:
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/workflow-runner.md` documents durable landing, ready-intent consumption, and the every-publication-commit sidecar exclusion; `v2/docs/write-behavior.md` documents that plan verdict and staging sidecars are never published; `v2/docs/v1-behaviors.md` records the changed plan-verdict publication behavior.

## Documentation updates

- `v2/docs/workflow-runner.md` — durable landing, ready-intent consumption, and workflow-created-commit sidecar exclusion.
- `v2/docs/write-behavior.md` — plan verdict and staging-sidecar publication behavior.
- `v2/docs/v1-behaviors.md` — additive v2 plan-verdict publication behavior.
