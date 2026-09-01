---
name: v1-implement-prompt-id-migration
---

# v1 implement prompt id migration

## Primary implementation surface

- v1 patch prompt rendering in `v1/src/modes/patch/`

## Prerequisites

- `implement.prompt.body` and `implement.rules` are registered; `patch.prompt.body` and `patch.rules` are absent from the registry.

## Problem

- v1 patch-mode prompt assembly still resolves `patch.prompt.body` and `patch.rules`, which the implement-owned artifact migration retires.

## Behavior

- v1 patch write and review paths resolve `implement.prompt.body` and `implement.rules` by id string only; assembly contract and rendered output shape stay unchanged aside from implement vocabulary already landed in the artifacts.

## Decision ledger

- Mechanical id-string updates at v1 call sites only; rules out v1 prompt prose edits or new v1-only artifact copies.
- Regenerate v1 rendered snapshot fixtures when artifact bytes change; rules out leaving stale `patch.prompt.body` fixtures after id retirement.

## Acceptance criteria

- [ ] `v1/test/prompts/rendered-snapshots.test.ts` stays green with fixtures keyed to `implement.prompt.body` and `implement.rules`; it fails against pre-fix `patch.prompt.body` / `patch.rules` registry lookups.
- [ ] `v1/test/prompt.test.ts` patch rules resolution uses `implement.rules`; it fails against the pre-fix id.
- [ ] `bun run typecheck` and `bun run test:v1` pass.

## Documentation updates

- `v1/docs/prompt-governance.md` — record v1 patch-mode resolution of implement-owned ids.
