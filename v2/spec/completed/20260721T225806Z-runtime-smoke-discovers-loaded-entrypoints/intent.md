---
name: runtime-smoke-discovers-loaded-entrypoints
---

# Runtime smoke discovers loaded entrypoints

Runtime-smoke discovery passes vacuously when production code changes beneath an unchanged entrypoint. Map changed production files to the runnable surfaces that load them.

## Decisions

- Discover implicated runnable surfaces from load relationships; rules out matching only literal changed entrypoint paths.
- A `v2/src/daemon/**` change implicates `v2/src/daemon-entrypoint.ts`; rules out extending a path allowlist one file at a time.
- A `v2/src/cli/**` change implicates `v2/src/cli.ts`; rules out treating CLI internals as non-runnable.
- Preserve distinct `not-runnable` and `observed-clean` outcomes; rules out reporting discovery absence as executed evidence.

## Acceptance criteria

- A daemon-only production diff selects `v2/src/daemon-entrypoint.ts` instead of `not-runnable`.
- A CLI-only production diff selects `v2/src/cli.ts` instead of `not-runnable`.
- `runtime-smoke-verifier.test.ts` covers both mappings and fails against the current literal-path discovery.
- Smoke discovery remains derived from the run-base production diff.

## Documentation updates

- `v2/docs/workflow-runner.md` — load-aware runtime-smoke discovery.
- `v2/docs/v1-behaviors.md` — record the changed v2 discovery guarantee.

## Prerequisites

- Runtime smoke derives production changed paths from the run-base diff.
