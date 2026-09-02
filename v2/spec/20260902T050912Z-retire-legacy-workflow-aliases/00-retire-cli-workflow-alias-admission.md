# Retire CLI workflow alias admission

## Problem

The hidden aliases `intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` (`workflow-args.ts`) print deprecation warnings, are absent from the help tree, and the reviewed-plan alias path is known-broken (false `killed`, stranded spec). Operator guidance is plain `plan` / `intent` with review flags.

## Decision ledger

- Delete CLI aliases without a sunset window; rules out keeping deprecation plumbing for a single-operator repo with no external consumers.
- Resolve alias strings as unknown workflows at CLI admission; rules out silently forwarding to canonical names with injected review flags.
- Whitelist CLI admission to `intent`, `plan`, and `implement` only; rules out relying on alias-table removal alone while `WORKFLOW_PRESET_BUILDERS` still keys the retired strings for pipeline resolution.
- Keep internal preset resolution for `intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light`; rules out removing `workflow-presets.ts` entries or changing daemon stage resolution in this subspec.

## Task checklist

- Remove `LEGACY_WORKFLOW_ALIASES` from `workflow-args.ts`.
- Remove alias resolution, `applyLegacyWorkflowAlias`, deprecation stderr, and alias-related types from `workflow.ts`; admit only `intent`, `plan`, and `implement` by CLI workflow name.
- Replace alias-forwarding coverage in `workflow.test.ts` with unknown-workflow admission cases for `intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light`; drop alias rows from detach, review-flag rejection, and other tables that assume alias admission.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `workflow.test.ts` rejects `run workflow intent-reviewed`, `run workflow plan-reviewed`, and `run workflow plan-reviewed-light` with `WORKFLOW_USAGE`, exit code `1`, and no deprecation stderr before daemon contact; the cases fail against the pre-fix alias forwarding reachable from `v2/src/commands/workflow.ts`.
- [x] `workflow-args.ts` exports no `LEGACY_WORKFLOW_ALIASES` symbol.
- [x] `workflow.ts` contains no `applyLegacyWorkflowAlias` helper and no alias-resolution branch in workflow preset builder lookup.
- [x] `workflow.test.ts` tests `run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON`, `run workflow intent with --detach prints intent paths stderr before run ID without client wait`, and `run workflow plan resets a stale worktree before daemon start` stay green.
- [x] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

None in this subspec; `v2/docs/v1-behaviors.md` is owned by subspec 01.
