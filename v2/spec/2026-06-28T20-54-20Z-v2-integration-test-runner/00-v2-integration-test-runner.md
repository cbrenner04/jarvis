# 00 - V2 integration test runner

Separate v2 `*.sandbox-unrunnable.test.ts` files from `test:v2` into a dedicated serial integration script. `test:v2` is the sandbox-agent-facing slice; aggregate `bun run test` and `ready` are unchanged in this work.

## Decisions

- Add `test:integration:v2` for all v2 `*.sandbox-unrunnable.test.ts` at any depth under `v2/` and run serially — rules out folding real OS seam tests into parallel `test:v2`.
- Exclude all v2 `*.sandbox-unrunnable.test.ts` from `test:v2` — rules out agent-runnable v2 checks reporting vacuous integration passes in sandbox.
- Enforce `test:v2` collection by enumerated file-set regression under `v2/**`, not `package.json` script-string equality — rules out reverting to bare `bun test ./v2/` without exclusion.
- Leave aggregate `test` and `ready` collecting whole v2 (including sandbox-unrunnable) — rules out repo-wide gate churn in this slice.
- Leave `coverage:v2` whole-v2 (`bun test --coverage ./v2/`) — intentional asymmetry vs `test:v2`; rules out coverage slice churn before a consumer needs parity.
- Keep exact `package.json` script-string pinning for `test:v1` and `test:shared` only; `test:v2` boundary moves to file-set assertions — rules out breaking the v1/shared trailing-slash invariant while changing `test:v2`.
- Use a small script under `scripts/` if Bun cannot express the exclusion reliably — rules out shell `find` one-offs.
- Leave v1 and shared sandbox-unrunnable tests on their current `test:v1` / `test:shared` script paths — rules out cross-surface slice churn in this work.

## Tasks

- Add `test:integration:v2` to `package.json`; wire it to collect all v2 `*.sandbox-unrunnable.test.ts` files (any depth under `v2/`) and run without `--parallel`.
- Change `test:v2` so it collects every `v2/**/*.test.ts` except `*.sandbox-unrunnable.test.ts`.
- Migrate `test/test-slices.test.ts`: keep `test:* scripts use exact root paths with trailing slashes` exact-string checks for `test:v1` and `test:shared` only; add enumerated file-set cases for `test:v2` and `test:integration:v2`.
- Update `v2/docs/test-writing.md` Real-process / real-clock tests section with v2 run-command routing.
- Update `v2/docs/v1-behaviors.md` test-command catalog for `test:v2` and `test:integration:v2`.
- Update `v1/docs/test-coverage.md` and/or `v2/docs/v1-behaviors.md` for `coverage:v2` whole-v2 asymmetry vs `test:v2`.

## Acceptance criteria

- [ ] `bun run test:v2` collects every `v2/**/*.test.ts` except `*.sandbox-unrunnable.test.ts` and collects none of the three on-disk v2 sandbox-unrunnable files (`v2/src/preload.sandbox-unrunnable.test.ts`, `v2/src/external-worktree.sandbox-unrunnable.test.ts`, `v2/src/daemon.sandbox-unrunnable.test.ts`).
- [ ] `bun run test:integration:v2` collects every v2 `*.sandbox-unrunnable.test.ts` at any depth under `v2/` (the three files above today) and no other test files; does not pass `--parallel`.
- [ ] `test/test-slices.test.ts` `test:* scripts use exact root paths with trailing slashes` keeps exact `package.json` string checks for `test:v1` and `test:shared` only; new or updated cases assert enumerated collected file sets for `test:v2` and `test:integration:v2` against the on-disk `v2/**` inventory.
- [ ] `test/test-slices.test.ts` `ready script uses aggregate test command` stays green.
- [ ] `package.json` `test:v1` and `test:shared` script values stay `bun test ./v1/` and `bun test ./shared/ ./test/`; `test:v2` may change to implement exclusion.
- [ ] `v2/docs/test-writing.md` Real-process / real-clock tests section documents v2 sandbox-unrunnable tests run via `bun run test:integration:v2` (sandbox-off), are excluded from `test:v2`, and remain in aggregate `bun run test`.
- [ ] `v2/docs/v1-behaviors.md` records `test:integration:v2` and the updated `test:v2` exclusion behavior.
- [ ] `v1/docs/test-coverage.md` and/or `v2/docs/v1-behaviors.md` records that `coverage:v2` still covers whole `v2/` including sandbox-unrunnable files (intentional asymmetry vs `test:v2`).

## Documentation updates

- `v2/docs/test-writing.md` — Real-process / real-clock tests section: v2 integration run commands and `test:v2` exclusion.
- `v2/docs/v1-behaviors.md` — test-command catalog for `test:v2`, `test:integration:v2`, and `coverage:v2` asymmetry.
- `v1/docs/test-coverage.md` — `coverage:v2` whole-v2 scope vs `test:v2` exclusion (if not fully covered in `v1-behaviors.md`).
