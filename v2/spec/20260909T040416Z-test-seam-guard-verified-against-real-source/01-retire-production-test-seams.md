# 01 - Retire production test seams

## Problem

Once detection is real, `bun run check` reports four seams on the clean tree and `main` goes red: `bypassPersistedReadyGateRepairFenceForTest` on `WriteLoopInput` (`write-loop.ts`) and `ReviewMutationResumeDeps` (`workflow-runner-resume.ts`), `mutationRepairBindingFactoryForTest` on `ReviewMutationResumeDeps`, and the exported `resetVerifierTestRunTrackingForTest` / `isInsideTimerCallbackForTest` in `diff-derived-mutation-verifier.ts`. The guard cannot land honest without retiring them in the same change.

## Decisions

- The persisted-fence bypass flag becomes a neutral injection seam: optional `persistedRepairFenceEnforcer` on `WriteLoopInput` and `ReviewMutationResumeDeps` with the same signature as `enforcePersistedReadyGateRepairFence`, defaulting to the real enforcer; production never passes it, tests inject a no-op where they previously set the flag; rules out a production off-switch flag (the `remove-ready-gate-repair-fence-bypass-from-production` ready-intent's own decision) and rules out renaming the flag to evade the guard.
- `mutationRepairBindingFactoryForTest` is renamed `mutationRepairBindingFactory` — it is an ordinary dependency-injection seam for the repair binding, not a test flag; rules out a second bespoke factory.
- `resetVerifierTestRunTrackingForTest` is renamed `resetVerifierTestRunTracking` (test-only consumer keeps working); `isInsideTimerCallbackForTest` has no consumer and is deleted; rules out keeping dead exports alive under new names.
- The `remove-ready-gate-repair-fence-bypass-from-production` ready-intent is consumed by this subspec and removed; rules out a second run redoing the same seam.

## Tasks

- Replace the bypass flag with the injected enforcer at both call sites; update the six test usages.
- Rename the factory and reset helper; delete the dead helper.
- Remove `v2/spec/ready-intents/remove-ready-gate-repair-fence-bypass-from-production.md`.

## Acceptance criteria

- [ ] `bun run scripts/guard-production-test-flags.ts` exits 0 on the clean tree with `00`'s structural detection in place, and the `reports every seam present in the scan roots` meta-test finds zero candidates.
- [ ] `v2/src/execution/workflow-runner-resume.test.ts` ready-gate repair fence cases stay green after bypass removal.
- [ ] `v2/src/execution/write-loop.test.ts` repair-fence rejection tests stay green, including the case that previously asserted a bypassed run completes.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` stays green through the rename.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — ready-gate repair fence tests inject `persistedRepairFenceEnforcer` instead of a production bypass flag.
