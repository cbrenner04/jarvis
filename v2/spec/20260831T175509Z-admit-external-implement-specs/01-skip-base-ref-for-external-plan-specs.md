# Skip base-ref membership for external plan specs

After external admission lands, `resolveImplementLaunch` still runs `isSpecAvailableInBaseRef` against the registered project root and refuses external plan trees that were never committed to `--base`.

## Decisions

- Skip `isSpecAvailableInBaseRef` when `ImplementSpecIdentity.externalPlanSpec` is true; rules out applying the in-repo `git cat-file` gate to Jarvis-owned storage.
- Pass `absoluteSpecPath` through launch input and built write-step `specPath`/`expectedArtifactPath` for admitted external indexes; do not rewrite to a repository-relative path in `resolveImplementLaunch`; rules out relocating the spec tree into the target checkout for launch.
- Leave chained `preflightGitRoot` launches and ordinary in-repo implement launches on the existing base-ref gate; rules out a global skip.

## Tasks

- Branch `resolveImplementLaunch` (and any chained helper that reuses the gate) on `externalPlanSpec` from `00`.
- Ensure `buildImplementWorkflowSteps` source-step `specPath`/`expectedArtifactPath` use `absoluteSpecPath` for admitted external indexes.
- Add a regression test proving an incomplete external plan index builds without base membership; preserve existing in-repo base-ref tests.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` builds an incomplete external plan index without requiring membership in `--base` and emits write-step `specPath` as the external-absolute `absoluteSpecPath`; it fails against the pre-fix `Spec path unavailable in base ref` refusal reachable on `resolveImplementLaunch`.
- [ ] `implement-workflow-steps.test.ts` `accepts a base-tracked spec launched below the registered project root` stays green (in-repo base-ref availability unchanged).

## Documentation updates

- `v2/docs/workflow-runner.md` — state that admitted external plan indexes bypass the `--base` membership check while in-repo specs keep it; note admission/preflight scope only (cross-link execution routing sibling intent).
