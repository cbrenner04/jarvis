---
name: v2-integration-test-runner
---

# v2 integration test runner

Separate v2 sandbox-unrunnable tests from the default v2 slice.

## Prerequisites

## Decisions

- Add `test:integration:v2` for `./v2/**/*.sandbox-unrunnable.test.ts` and run it serially; rules out folding real OS seam tests into the parallel v2 slice.
- Exclude `*.sandbox-unrunnable.test.ts` under `./v2/` from `test:v2`; rules out agent-runnable v2 checks reporting vacuous integration passes.
- Leave aggregate `test`, `test:v1`, `test:shared`, and `ready` unchanged; rules out repo-wide gate churn.
- Use a small script if Bun cannot express the exclusion reliably; rules out shell `find` one-offs.

## Behavior

- `bun run test:v2` runs v2 agent-runnable tests and does not collect v2 `.sandbox-unrunnable.test.ts` files.
- `bun run test:integration:v2` collects only v2 `.sandbox-unrunnable.test.ts` files and runs them without `--parallel`.
- Existing v1/shared sandbox-unrunnable tests stay on their current script paths.
- `test/test-slices.test.ts` pins the new script boundary.

## Documentation updates

- Update `v2/docs/test-writing.md` with the v2 split: integration tests use `test:integration:v2`; `test:v2` excludes them.
