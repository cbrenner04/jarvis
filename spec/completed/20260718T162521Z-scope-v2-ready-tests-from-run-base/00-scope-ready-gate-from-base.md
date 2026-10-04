# Scope the v2 ready gate test step from the run base

## Problem

`createDefaultRunReadyGate` (`v2/src/execution/ready-finalize.ts`) spawns `bun run ready`
with `JARVIS_READY_TIER: "full"` and no test scope, so completion always runs the full
aggregate test suite. The run already knows its base ref, and the shared classifier plus
`ready.ts`'s `JARVIS_READY_TEST_SCOPE` support exist — v2 just doesn't wire them together.
v1 already does this in `v1/src/ready-gate.ts` (`resolveReadyTestScope`).

## Decisions

- Thread the run's `baseRef` into `ReadyFinalizeInput` and the `ReadyGate` signature; rules out assuming `main` or rediscovering the base from git config.
- Diff `<baseRef>...HEAD` in the completed run's worktree (three-dot, merge-base relative), including untracked files; rules out caller-supplied changed paths.
- Reuse `classifyChangedPaths` + `resolveCiTestScope` from `scripts/ci-test-scope.ts`; rules out a v2-only classifier and rules out importing v1's `resolveReadyTestScope` (v2 must not import v1).
- Serialize the resolved scope as `JARVIS_READY_TEST_SCOPE` beside the unchanged `JARVIS_READY_TIER: "full"` (`"full"` verbatim, otherwise space-joined script names); rules out narrowing the ready tier.
- A failed diff resolves scope via `resolveCiTestScope(paths, false)` → `"full"`; rules out failing finalization before the authoritative gate runs.
- Pass `baseRef: input.baseRef` at the `write-loop.ts` `publishCompletionArtifacts` call site so the repair/retry loop inherits it through the shared `input`; rules out a second wiring path.

## Task checklist

- Add `baseRef` to `ReadyFinalizeInput` and thread it through `ReadyGate`.
- Add a scope resolver (diff `<baseRef>...HEAD` + untracked, then `resolveCiTestScope`) reusing the shared classifier.
- Set `JARVIS_READY_TEST_SCOPE` in the ready child env in `createDefaultRunReadyGate`, keeping `JARVIS_READY_TIER: "full"`.
- Pass `baseRef` from the completion `input` into the readyFinalizer call in `write-loop.ts`.
- Update `ready-finalize.test.ts` with base-scoped and unresolved-base cases.
- Docs: `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] When the run's `baseRef` resolves and only `v2/**` source changed relative to it, the default ready gate spawns `bun run ready` with `JARVIS_READY_TEST_SCOPE` set to the v2 test scripts (not `full`) and `JARVIS_READY_TIER: "full"` unchanged.
- [x] When the `<baseRef>...HEAD` diff fails (unresolvable base), the ready gate spawns with `JARVIS_READY_TEST_SCOPE=full` and finalization still proceeds rather than erroring.
- [x] The full ready tier is unchanged: the gate still passes `JARVIS_READY_TIER: "full"` and the non-test gate steps (check, typecheck, lint:md) are unaffected by scoping.
- [x] `baseRef` flows from the completion `input` through `ReadyFinalizeInput` to the gate, including the ready-repair retry path.
- [x] A test in `v2/src/execution/ready-finalize.test.ts` drives the default gate against a real git fixture worktree where only `v2/**` changed vs `baseRef` and asserts the child env carries the scoped `JARVIS_READY_TEST_SCOPE`; it fails against the pre-fix gate (which sets no scope) and passes after the change.
- [x] A test asserts the unresolved-base fallback sets `JARVIS_READY_TEST_SCOPE=full`; it fails against pre-fix code and passes after.

## Documentation updates

- `v2/docs/write-behavior.md` — ready finalization scopes its test step from the run base while the full tier stays active.
- `v2/docs/operator-runbook.md` — Gate trust: test step is base-scoped; unresolvable base falls back to the full aggregate suite; non-test steps and the full tier are unchanged.
- `v2/docs/v1-behaviors.md` — record v1/v2 parity: ready-gate test step scoped from the run base via the shared classifier, full-suite fallback on unresolved base.
