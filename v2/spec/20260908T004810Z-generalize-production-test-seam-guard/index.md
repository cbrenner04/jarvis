# Generalize production test-seam guard

Broaden `scripts/guard-production-test-flags.ts` beyond the historical `invert*ForTest` family so `bun run check` flags generalized `ForTest`/`ForTests` setters, module variables, parameters, and type members in production `src/` outside `testing/`, while preserving existing `invert*` detection and scan roots.

## Implement order

- Merge `remove-ready-gate-repair-fence-bypass-from-production` first — reachable `*ForTest` type members and parameters on `WriteLoopInput` / `ReviewMutationResumeDeps` (`bypassPersistedReadyGateRepairFenceForTest`) fail the broadened guard on main today.
- Restructure `mutationRepairBindingFactoryForTest` on `ReviewMutationResumeDeps` to a neutral injection seam before this spec merges — reachable on `v2/src/execution/workflow-runner-resume.ts` on main today.

## Subspecs

- [x] [00 - Generalize production test-seam guard](./00-generalize-production-test-seam-guard.md)
- [x] [01 - Align coding-standards test-seam section](./01-align-coding-standards-test-seam-section.md)
- [x] [02 - Align test-writing forbidden seams](./02-align-test-writing-forbidden-seams.md)
