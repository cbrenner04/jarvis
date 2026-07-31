# Project pipeline resolution drops invert-for-test hooks

`project-pipeline-resolution.ts` exports `setInvertTerminalActionConflictGuardForTest` and a module
variable so guard-inversion tests pass without mutating the real `lacksImplementStage` guard.

## Decisions

- Strip all four forbidden hook shapes from `project-pipeline-resolution.ts` — inline real guard.
- Delete dedicated invert test; add `Mutation checkpoint:` on the positive pinning test.

## Tasks

- **project-pipeline-resolution.ts:** remove `invertTerminalActionConflictGuardForTest` and
  `setInvertTerminalActionConflictGuardForTest`; inline real guard.
- **project-pipeline-resolution.test.ts:** delete `inverting terminal-action conflict guard admits
  pipelines without an implement workflow stage`; add `Mutation checkpoint:` on `rejects
  terminal-action approval conflicts` naming mutation on the `lacksImplementStage` guard branch.
- Run `bun run typecheck` and `bun test v2/src/execution/project-pipeline-resolution.test.ts`.

## Acceptance criteria

- [x] `project-pipeline-resolution.ts` carries no `setInvert*ForTest` export, `invert*ForTest`
  module variable, `invert*` function parameter, or `invert*ForTest` type member.
- [x] In `project-pipeline-resolution.test.ts`, the documented `lacksImplementStage` mutation turns
  `rejects terminal-action approval conflicts` RED. (Manual)
- [x] `project-pipeline-resolution.test.ts` — `rejects terminal-action approval conflicts` stays
  green.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
