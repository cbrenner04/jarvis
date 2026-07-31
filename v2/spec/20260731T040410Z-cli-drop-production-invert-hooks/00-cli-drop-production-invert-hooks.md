# CLI production code drops invert-for-test hooks

CLI modules (`workflow`, `run`, `run-list-rpc`, `pipeline`, `cleanup`) export
`setInvert*ForTest` hooks and thread `invert*` parameters (e.g. `invertGuard` in
`pipeline.ts`) so guard-inversion ACs pass without mutating real admission, list,
wait, or cleanup guards.

**Scope:** production hook removal in `v2/src/commands/**/*.ts` outside `*.test.ts`.
Cross-surface `workflow.test.ts` rewrites checkpoint daemon/execution guards in
tests only — no edits to those production modules.

## Prerequisites

- **Daemon** (`daemon-drop-production-invert-hooks` merged): daemon production
  modules carry no forbidden invert hooks; CLI tests must not import daemon setters.
- **Write-step rules** (`write-step-rules-forbid-production-invert-hooks`):
  comment-checkpoint guard-inversion contract in effect.
- **Execution** (`execution-loop-drop-production-invert-hooks`): **not** a blocker
  for CLI production edits. Cross-surface `workflow.test.ts` cases name comment
  checkpoints on execution production guards and drop execution setter imports;
  CLI does not edit `external-worktree.ts`.

## Decisions

- **In scope (production):** strip all four forbidden hook shapes from
  `v2/src/commands/**/*.ts` outside `*.test.ts` — rules out allowlisting shipped
  hooks or deferring `invertGuard` parameter plumbing.
- **In scope (tests only):** `workflow.test.ts` rewrites that checkpoint
  daemon/execution guards without editing those production modules — rules out
  cross-imported setters surviving after owning surfaces drop hooks.
- Comment-checkpoint guard-inversion per `v2/docs/test-writing.md` (Guard-inversion
  evidence) and exemplar `daemon-workflow-start.test.ts`: checkpoint comment lives
  in the pinning test; mutation targets the owning production guard (including
  cross-surface cases).
- `workflow.ts` and `pipeline.ts` each have independent detach client-wait module
  variables — two separate checkpoints; removing hooks in only one module leaves debt.
- Rewrite every CLI guard-inversion case to comment-checkpoint source mutations on
  the real guard — rules out dedicated invert `test()` bodies that call deleted setters.
- Delete `exitCodeForPipelineMutationOutcome` `invertGuard` parameter and inline
  success/failure exit mapping at `runPipelineMutationCommand` call sites — rules out
  parameter-shaped test plumbing surviving export cleanup.
- `forceSkipAttachClientWaitForTest` and `attachWaitRunIdOverrideForTest` in
  `workflow.ts` are out of scope — not `invert*` hooks; separate cleanup if needed.
- Documentation updates: none — `write-step-rules-forbid-production-invert-hooks`
  owns guard-inversion operator docs.

## Tasks

- Remove forbidden invert hooks from production: `workflow.ts`
  (`invertDetachClientWaitGuardForTest`), `run.ts` (`invertListStatusValidationForTest`,
  `invertRunOwnerResolutionForTest`), `run-list-rpc.ts`
  (`invertListRpcRequestIsFilteredForTest`), `pipeline.ts` (six module variables,
  six setters, `invertGuard` threading), `cleanup.ts`
  (`invertCleanupSocketDiscoveryForTest`, `invertCleanupSocketSkipOnFailureForTest`).
- Rewrite guard-inversion coverage to comment checkpoints on pinning tests:
  - `workflow.test.ts` — detach client-wait guard; kill-before-repair-quiescence
    (`settleKilledWorkflowOwnership` in daemon); registry release before guarded kill
    (`invertRegistryReleaseBeforeKill` on `settleKilledWorkflowOwnership` in daemon);
    external-worktree lock-release (execution guard).
  - `run.test.ts` — cross-daemon owner resolution (`run log`, `run wait`).
  - `run-list-dimension-filters.test.ts` — `invalid_status` validation;
    `listRpcRequestIsFiltered` retention filter (checkpoint on `listRpcRequestIsFiltered`
    in `run-list-rpc.ts`; handler positive `dimension-only filtered query bypasses
    terminal retention`; CLI integration positive `run log stream-open and tui log
    tail-open accept dimension-listed runs beyond retention`).
  - `pipeline.test.ts` — pre-admission resolution, detach client-wait, list non-follow,
    wait boundary, applied refused, resumed refused.
  - `cleanup.test.ts` — socket discovery union (`older-digest live daemon makes merged
    worktree ineligible`); skip-on-failure when connect errors (`one dead socket in
    query set does not blank eligibility when another reports live run`).
- Remove setter usage from guard-inversion coverage without deleting positive pinning
  tests:
  - **Pipeline/workflow:** delete dedicated `test("inverting …")` blocks and their
    `afterEach` setter resets; add comment checkpoints on the named production guard.
  - **Cleanup / run-list:** remove mid-test setter toggles inside positive pinning
    tests; add comment checkpoints on the named production guard.
- Drop setter imports no longer referenced after the rewrites above.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `v2/src/commands/**/*.ts` outside `*.test.ts` carry no `setInvert*ForTest`
  export, `invert*ForTest` module variable, `invert*` function parameter, or
  `invert*ForTest` type member in the worktree.
- [ ] (Manual) Inverting the pre-admission resolution guard-inversion mutation
  documented in `pipeline.test.ts` turns its pinning test RED.
- [x] `pipeline.test.ts` — `failed daemon admission exits non-zero with stderr detail
  and no pipeline ID on stdout` stays green.
- [x] `pipeline.test.ts` — `pipeline approve exits 0 on applied decision and sends both
  IDs`, `pipeline reject exits 0 on applied decision and sends both IDs`, and
  `pipeline resume exits 0 on resumed for …` stay green.
- [x] `workflow.test.ts` — `run workflow implement with --detach admits and exits
  without client wait` stays green.
- [x] `run.test.ts` — `run log streams a run owned by a non-invoking live daemon` and
  `run wait resolves a run owned by a non-invoking live daemon` stay green; owner-
  resolution guard-inversion cases use comment checkpoints (no setter import or call).
- [x] `run-list-dimension-filters.test.ts` — `dimension-only filtered query bypasses
  terminal retention` and `run log stream-open and tui log tail-open accept
  dimension-listed runs beyond retention` stay green.
- [x] `cleanup.test.ts` — `older-digest live daemon makes merged worktree ineligible`
  and `one dead socket in query set does not blank eligibility when another reports
  live run` stay green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — shared guard-inversion doc already updated by
  `write-step-rules-forbid-production-invert-hooks`.
