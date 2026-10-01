---
name: ready-repair-prompt-allowed-paths
---

# Ready-gate repair prompt lists the attributable path allowset

## Problem

`write.ready-repair` omits the attributable allowset the repair fence enforces, so agents edit refused paths and runs settle `completion_commit_failed`.

## Decisions

- Add `ALLOWED_PATHS` to `prompts/write/ready-repair.md` (revision bump): one path per line from `resolveAttributableRepairAllowset(frozenRepairAllowset, current ReadyGateError)` computed before the repair agent runs, plus one sentence that edits outside the list are reverted and end the run.
- Render the placeholder in the write-loop ready-repair reprompt path; generic across target repos.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-ready-repair.test.ts` (new; `write-loop.test.ts` is over budget pending its split): the ready-repair prompt renders `ALLOWED_PATHS` equal to `resolveAttributableRepairAllowset(frozen, error)` for marker-attributed lint failures and for frozen-run-diff fallback; fails when the placeholder is empty or the frozen set is rendered for a marker-attributed failure.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — add `ALLOWED_PATHS` to the `write.ready-repair` row.
- `v2/docs/workflow-runner.md` § Ready gate repair — note the repair agent receives the attributable allowset in the prompt.

## Primary implementation surface

v2/src/execution/write-loop.ts

## Prerequisites
