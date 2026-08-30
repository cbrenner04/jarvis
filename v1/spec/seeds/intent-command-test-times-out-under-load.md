# v1/test/intent-command.test.ts times out under full-suite CI parallel load

## Problem

`v1/test/intent-command.test.ts` (2198 lines, 57 tests, each `spawnSync`-ing the real `jarvis1` binary) intermittently times out or is killed under CI's parallel test load: `error: "agent" test run timed out or was killed on file "v1/test/intent-command.test.ts"`. It passes in isolation. Before the push-CI scoping fix (this PR), every push to main ran the full aggregate suite, so this flake reddened main on ~4 of 7 merges in one 2026-08-30 session — including markdown-only spec merges. Push-CI scoping removes the exposure for non-v1 changes, but a legitimate `v1/**` change still scopes `test:v1` and re-exposes the timeout, and PR CI on `v1/**` diffs runs it too.

## Decisions

- De-flake at the file, not by widening the per-file timeout (the 180s floor is a deliberate invariant). Options to weigh: split the 2198-line file into cohesive per-concern files so no single file's serial spawn chain exceeds the budget; and/or cap the real-binary `spawnSync` fan-out / share fixture setup so wall time drops. Rules out raising the global timeout or disabling the test.
- Keep coverage: every current assertion survives the split (inventory-diff before/after). Rules out dropping cases to shrink runtime.

## Acceptance criteria

- [ ] `v1/test/intent-command.test.ts` is split (or its per-test binary-spawn cost reduced) such that no resulting file exceeds the per-file test budget under `bun run test:v1` on a loaded machine; the pre-change file's test titles all still exist (inventory-diff).
- [ ] `bun run test:v1` and `bun run test:integration:v1` pass.

## Documentation updates

- `v1/docs/operator-runbook.md` — note the flake and that push-CI scoping bounds its blast radius to `v1/**` changes.
