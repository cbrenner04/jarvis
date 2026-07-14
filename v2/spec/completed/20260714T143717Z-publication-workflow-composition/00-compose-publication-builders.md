# Compose publication definitions and builders

Replace the duplicate intent and plan construction paths with one publication builder table while retaining their operator contracts.

## Decisions

- Key one publication definition by `intent` and `plan`; rules out replacing the named operator presets with generic preset names.
- Each row selects its prompt, staging directory, output contract, and landing kind; rules out rebuilding those choices in preset-specific functions.
- Share project, target, Git/no-Git, worktree, loading, and publication assembly while row-owned input resolvers retain seed/ready-intent validation and identity rules; rules out weakening distinct input contracts to force uniformity.
- Build reviewed variants from the same publication row until optional review is composed separately; rules out retaining duplicate publication builders behind reviewed names.
- Delete `intent-workflow-steps.ts` and `plan-workflow-steps.ts` without compatibility wrappers once callers use the composed builder; rules out move-only consolidation.

## Tasks

- Add the typed publication definition and composed builder.
- Route current intent, intent-reviewed, plan, plan-reviewed, and plan-reviewed-light registrations through it.
- Consolidate focused builder tests and remove replaced builder production surfaces.

## Acceptance criteria

- [x] `v2/src/execution/publication-workflow-steps.test.ts` fails against the baseline and proves the `intent` and `plan` rows select their existing prompt, staging directory, output contract, and landing kind.
- [x] File/inline intent inputs and ready-intent plan inputs retain their validation, target precedence, identity, collision, base, branch, Git publication, and Git-disabled durable-output contracts.
- [x] Reviewed and unreviewed variants source their publication step from the same named row, with current review ordering, pass-count behavior, workspace, and verdict paths preserved.
- [x] `v2/src/cli.test.ts` intent/plan workflow-launch cases stay green (operator names, arguments, pre-daemon failures, and one daemon start are unchanged).
- [x] `intent-workflow-steps.ts` and `plan-workflow-steps.ts` are deleted, their callers use one smaller replacement, and no preset-specific publication-builder wrapper remains.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md`: replace separate intent/plan builder ownership with the publication rows and shared-versus-row-owned boundaries.
