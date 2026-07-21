# Discover loaded entrypoints

Runtime-smoke discovery currently selects only entrypoint files named directly
in the production diff. Select the unchanged runnable surface that loads a
changed CLI or daemon module so these diffs cannot pass vacuously.

## Decisions

- Map `v2/src/daemon/**` production changes to `v2/src/daemon-entrypoint.ts`; rules out requiring the entrypoint file itself to change.
- Map `v2/src/cli/**` production changes to `v2/src/cli.ts`; rules out classifying loaded CLI internals as non-runnable.
- Derive loaded-surface mappings from the existing run-base production paths; rules out a second diff or working-tree scan with a different scope.
- Preserve `not-runnable` for no discovered surface and `observed-clean` only after execution succeeds; rules out treating discovery absence as runtime observation.

## Task checklist

- Extend runtime-smoke discovery with the daemon and CLI load-owner mappings.
- Add focused regression coverage for daemon-only and CLI-only production diffs.
- Align durable runtime-smoke discovery documentation.

## Acceptance criteria

- [ ] A daemon-only run-base production diff executes `v2/src/daemon-entrypoint.ts` instead of returning `not-runnable`.
- [ ] A CLI-only run-base production diff executes `v2/src/cli.ts` instead of returning `not-runnable`.
- [ ] `v2/src/execution/runtime-smoke-verifier.test.ts` covers both mappings and fails against the pre-fix literal-path discovery.
- [ ] Discovery remains derived from the run-base production diff; no mapped surface returns `observed-clean` unless its execution succeeds.
- [ ] Existing `not-runnable` coverage in `v2/src/execution/runtime-smoke-verifier.test.ts` stays green for production paths with no discovered runnable surface.

## Documentation updates

- `v2/docs/workflow-runner.md` — load-aware runtime-smoke discovery from the run-base production diff.
- `v2/docs/write-behavior.md` — align the runnable-surface contract and cross-link instead of retaining literal-path semantics.
- `v2/docs/v1-behaviors.md` — record the changed v2 discovery guarantee.
