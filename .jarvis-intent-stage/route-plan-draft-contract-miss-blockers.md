---
name: route-plan-draft-contract-miss-blockers
---

# Route plan-draft contract-miss blockers to staged intent

Splitting does not apply: contract-miss blocker routing and append safety both belong to the execution-loop settlement seam.

## Prerequisites

- Plan-draft writes identify the draft step with `plan.prompt.draft` and stage its editable intent at `<expectedArtifactPath>/intent.md`.

## Problem

- A `plan.draft.blocker` miss falls through to the not-yet-created durable spec-directory path, where blocker append creates a bare file that prevents later spec-tree publication and escapes normal cleanup and discovery.

## Decisions

- Route every `plan.prompt.draft` contract-miss blocker to staged `<expectedArtifactPath>/intent.md`; rules out per-contract routing and writes beneath the durable spec path before publication.
- Append a harness blocker only when the resolved target is an existing regular file; otherwise retain contract-miss logging and settlement without creating a path, ruling out materializing a bare file at a missing spec-directory target.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` fails against the pre-fix code, then proves a plan-draft `plan.draft.blocker` miss appends its failure to staged `intent.md` and leaves the durable spec-directory path absent.
- [ ] `v2/src/execution/write-loop.test.ts` proves a contract miss whose resolved blocker target is absent remains logged and settled without creating the target.
- [ ] `v2/src/execution/write-loop.test.ts` test `plan-draft normalizer contract_miss appends blocker to staged intent.md` stays green, preserving plan-draft `artifact.exists` routing.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — all plan-draft contract-miss blockers land on staged `intent.md`, and blocker settlement never creates a missing target.
- `v2/docs/v1-behaviors.md` — record the v2 plan-draft contract-miss blocker routing and append-safety behavior.
