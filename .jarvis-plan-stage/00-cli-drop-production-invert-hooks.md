# CLI production code drops invert-for-test hooks

CLI modules (`workflow`, `run`, `run-list-rpc`, `pipeline`, `cleanup`) export
`setInvert*ForTest` hooks and thread `invert*` parameters (e.g. `invertGuard` in
`pipeline.ts`) so guard-inversion ACs pass without mutating real admission, list,
wait, or cleanup guards.

**Prerequisite:** `daemon-drop-production-invert-hooks` merged and implemented —
daemon production modules must carry no forbidden invert hooks before this subspec
runs; `workflow.test.ts` cross-surface guard-inversion rewrites target guards in
already-cleaned daemon/execution modules.

## Decisions

- Strip all four forbidden hook shapes from `v2/src/commands/**/*.ts` outside `*.test.ts` — rules out allowlisting shipped hooks or deferring `invertGuard` parameter plumbing.
- Rewrite every CLI guard-inversion case to comment-checkpoint source mutations on the real guard — rules out dedicated invert `test()` bodies that call deleted setters.
- Delete `exitCodeForPipelineMutationOutcome` `invertGuard` parameter and inline success/failure exit mapping at `runPipelineMutationCommand` call sites — rules out parameter-shaped test plumbing surviving export cleanup.
- `workflow.test.ts` guard-inversions that today import daemon or execution setters become comment checkpoints naming mutations in the owning module's production guard — rules out CLI tests calling cross-surface setters after those surfaces drop hooks.
- `forceSkipAttachClientWaitForTest` and `attachWaitRunIdOverrideForTest` in `workflow.ts` are out of scope — not `invert*` hooks; separate cleanup if needed.
- Documentation updates: none — `write-step-rules-forbid-production-invert-hooks` owns guard-inversion operator docs.

## Tasks

- Remove forbidden invert hooks from production: `workflow.ts` (`invertDetachClientWaitGuardForTest`), `run.ts` (`invertListStatusValidationForTest`, `invertRunOwnerResolutionForTest`), `run-list-rpc.ts` (`invertListRpcRequestIsFilteredForTest`), `pipeline.ts` (six module variables, six setters, `invertGuard` threading), `cleanup.ts` (`invertCleanupSocketDiscoveryForTest`, `invertCleanupSocketSkipOnFailureForTest`).
- Rewrite guard-inversion coverage to comment checkpoints on pinning tests:
  - `workflow.test.ts` — detach client-wait guard; kill-before-repair-quiescence and external-worktree lock-release cases that import daemon/execution setters.
  - `run.test.ts` — cross-daemon owner resolution (`run log`, `run wait`).
  - `run-list-dimension-filters.test.ts` — `invalid_status` validation; `listRpcRequestIsFiltered` retention filter.
  - `pipeline.test.ts` — pre-admission resolution, detach client-wait, list non-follow, wait boundary, applied refused, resumed refused.
  - `cleanup.test.ts` — socket discovery union; skip-on-failure when connect errors.
- Drop setter imports, `afterEach` resets, and invert-only `test()` blocks that exist only to toggle deleted hooks.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `v2/src/commands/**/*.ts` outside `*.test.ts` carry no `setInvert*ForTest` export, `invert*ForTest` module variable, `invert*` function parameter, or `invert*ForTest` type member; fails against pre-fix code that still ships the hooks.
- [ ] `pipeline.test.ts` pre-admission resolution guard-inversion coverage fails against pre-fix setter-based invert (bypass without exercising the real guard) and passes after rewrite to a comment checkpoint naming the production guard mutation.
- [ ] (Manual) Inverting the pre-admission resolution guard-inversion mutation documented in `pipeline.test.ts` turns its pinning test RED.
- [ ] `pipeline.test.ts` — `failed daemon admission exits non-zero with stderr detail and no pipeline ID on stdout` stays green (pre-admission guard behavior unchanged).
- [ ] `run.test.ts` — cross-socket `run log` and `run wait` positive tests stay green; setter-based owner-resolution invert tests drop in favor of comment checkpoints naming the `resolveRunOwnerSocket` guard mutation.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — shared guard-inversion doc already updated by `write-step-rules-forbid-production-invert-hooks`.
