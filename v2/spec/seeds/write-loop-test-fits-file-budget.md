---
name: write-loop-test-fits-file-budget
---

# write-loop.test.ts fits the per-file test budget with headroom

## Problem

`v2/src/execution/write-loop.test.ts` (~13.8k lines, ~404 tests) runs ~170 s serial on an idle machine against the 180 s `SUPPORTED_HEALTHY_FILE_BUDGET_MS` per-file timeout (`scripts/run-v2-tests.ts`). Any concurrent load pushes it over, so every lane touching `v2/**` gets a red `test:v2` naming `write-loop.test.ts` ("timed out or was killed"), regardless of its diff. Every new write-loop test makes it worse.

## Evidence

- 2026-10-01: ready gates of runs a360bdd6 (terminal-publication; settled `ready_gate_out_of_scope`, stop) and c7cd745e (agent-bindings, both attempts; `ready_gate_failed`) failed on the `write-loop.test.ts` timeout; the file was 404/404 green alone on branch and main.
- 2026-10-01: hand-finish of #4328 hit the 180 s budget on the same file under serial `test:v2`; reported ~170 s on main.

## Decisions

- Split `write-loop.test.ts` by `describe` area into co-located `write-loop-<area>.test.ts` siblings so no file exceeds ~60 s serial; test titles unchanged (mutation killing-set resolution already includes `<stem>-*.test.ts` siblings).
- The 180 s per-file budget is unchanged; no per-file exemptions.
- Shared fixtures move to a test-support module, not duplicated.

## Acceptance criteria

- [ ] `write-loop.test.ts` holds at most 120 tests and no `write-loop-*.test.ts` sibling added by the split holds more than 120.
- [ ] The union of test titles across `write-loop*.test.ts` after the split equals the set before it (a script or test diffing `bun test --only` listings, or a one-off check recorded in the PR).
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — per-file budget headroom guidance; split large suites by area.

## Operator verification

- Each `write-loop*.test.ts` file runs under 60 s alone on an idle machine.
