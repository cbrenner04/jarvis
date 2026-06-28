# 00 - V2 integration test runner

Separate v2 `*.sandbox-unrunnable.test.ts` files from the default `test:v2` slice into a dedicated serial integration script so sandbox agent runs of `test:v2` exercise only agent-runnable v2 tests.

## Decisions

- Add `test:integration:v2` for `./v2/**/*.sandbox-unrunnable.test.ts` and run it serially — rules out folding real OS seam tests into the parallel v2 slice.
- Exclude `*.sandbox-unrunnable.test.ts` under `./v2/` from `test:v2` — rules out agent-runnable v2 checks reporting vacuous integration passes in sandbox.
- Leave aggregate `test`, `test:v1`, `test:shared`, and `ready` unchanged — rules out repo-wide gate churn.
- Use a small script under `scripts/` if Bun cannot express the exclusion reliably — rules out shell `find` one-offs.
- Leave v1 and shared sandbox-unrunnable tests on their current `test:v1` / `test:shared` script paths — rules out cross-surface slice churn in this work.

## Tasks

- Add `test:integration:v2` to `package.json`; wire it to collect only v2 `*.sandbox-unrunnable.test.ts` files and run without `--parallel`.
- Change `test:v2` so it does not collect v2 `*.sandbox-unrunnable.test.ts` files.
- Extend `test/test-slices.test.ts` to pin the new script boundary.
- Update `v2/docs/test-writing.md` with the v2 split.
- Update `v2/docs/v1-behaviors.md` test-command catalog for the changed `test:v2` behavior and new `test:integration:v2` command.

## Acceptance criteria

- [ ] `bun run test:v2` runs v2 agent-runnable tests and does not collect any `v2/**/*.sandbox-unrunnable.test.ts` file.
- [ ] `bun run test:integration:v2` runs only `v2/**/*.sandbox-unrunnable.test.ts` files and does not pass `--parallel`.
- [ ] `test/test-slices.test.ts` pins `test:v2` exclusion and `test:integration:v2` collection boundaries.
- [ ] `test/test-slices.test.ts` `ready script uses aggregate test command` stays green (aggregate `test` and `ready` unchanged).
- [ ] `package.json` `test:v1` and `test:shared` script values stay `bun test ./v1/` and `bun test ./shared/ ./test/` respectively.
- [ ] `v2/docs/test-writing.md` documents that v2 sandbox-unrunnable tests run via `test:integration:v2` and are excluded from `test:v2`.
- [ ] `v2/docs/v1-behaviors.md` records `test:integration:v2` and the updated `test:v2` exclusion behavior.

## Documentation updates

- `v2/docs/test-writing.md` — v2 agent-runnable vs integration script split.
- `v2/docs/v1-behaviors.md` — test-command catalog for `test:v2` and `test:integration:v2`.
