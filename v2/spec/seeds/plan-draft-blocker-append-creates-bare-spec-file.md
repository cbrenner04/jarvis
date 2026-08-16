---
name: plan-draft-blocker-append-creates-bare-spec-file
---

# `plan.draft.blocker` miss appends the blocker to the durable spec-dir path, creating a bare file

## Problem

`blockerPath` in the write loop (`v2/src/execution/write-loop.ts`, contract-miss branch) routes plan-draft blockers to staged `intent.md` only when `failedContractId === "artifact.exists"`. Any other plan-draft miss — in practice `plan.draft.blocker` — falls through to `resolveSpecPath(worktreePath, args.specPath)`, which for a plan run is the not-yet-created durable spec *directory* (`v2/spec/<UTC>-<name>`). `appendFileSync` then creates a 4-line regular file at that path (`\n## Blocker\n\nArtifact contract check failed: plan.draft.blocker`). Observed 2026-08-16 on `plan/v2-init-command`: commit `6dc75d35` added `v2/spec/20260816T203445Z-v2-init-command` as a file, which the durable spec directory can never be created over, and which `jarvis cleanup`/spec discovery do not recognise.

## Decisions

- For `plan.prompt.draft` runs, every contract-miss blocker targets staged `<expectedArtifactPath>/intent.md`, regardless of which contract failed. Rules out per-contract path special-casing and rules out writing under the durable spec path before the tree is published.
- Never create a regular file at a path that is a spec directory target: if the resolved blocker path has no existing parent file the loop logs the miss and skips the append rather than materialising a bare file.

## Acceptance criteria

- [ ] A plan-draft `plan.draft.blocker` miss appends the blocker to staged `intent.md` and leaves the durable spec-dir path absent, pinned by a test that fails against the current fall-through.
- [ ] A plan-draft `artifact.exists` miss still appends to staged `intent.md` (unchanged), pinned by an existing test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — state that all plan-draft contract-miss blockers land on staged `intent.md`, never the durable spec path.
