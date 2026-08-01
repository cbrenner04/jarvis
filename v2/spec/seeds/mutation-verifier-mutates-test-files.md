---
name: mutation-verifier-mutates-test-files
---

# Mutation verification mutates test files and strands the run when the flip changes no assertion

## Problem

`diff-derived-mutation-verifier` derives mutation candidates from every changed **code path**,
including `*.test.ts` / `*.test.tsx`. Mutating a line inside a test fixture and then demanding that
the suite go red is incoherent: a fixture helper can be flipped without changing any assertion, and
that is not evidence of missing production coverage. The run settles
`surviving_mutation_failed`, and `jarvis run resume` re-verifies and fails the same way, so the
only exit is hand-finishing.

## Evidence

Run `10b4d17d-d631-4fd2-9b6e-e201dfdcaffc` (spec `20260801T122726Z-tui-pipeline-tree-monitor`),
2026-08-01. Resume output:

```text
internal_error: Surviving mutation in v2/src/tui/tui-entry.test.tsx:119: operator-flip: === → !==
```

Line 119 is a test fixture helper, not production:

```ts
function pipelineMultiRun(
  overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId" | "stepId" | "status">,
): DaemonListRunRow {
  return {
    project: "demo",
    branch: "main",
    isLive: overrides.status === "in-progress",   // <- line 119
```

Flipping it changes only the fixture's own liveness value; every assertion in the file still holds.

At that point all three subspecs' acceptance criteria were ticked, the completion commit existed,
draft PR #2466 was published, and `typecheck`, `check`, `lint:md`, `test:v2`, and
`test:integration:v2` were all green in the run's worktree. Only the mutation gate blocked it.

Candidate selection is at `deriveFromLine` / `isCodePath`
(`v2/src/execution/diff-derived-mutation-verifier.ts:300-318`): the only filter is the file
extension.

## Decisions

- Mutation candidates come from production sources only; test files are excluded from the candidate set. Rules out demanding a red suite for a mutation the suite cannot observe.
- Exclusion is by the repo's existing test-file convention (`*.test.ts`, `*.test.tsx`, `*.sandbox-unrunnable.test.ts`), not an allowlist. Rules out a per-file opt-out list that drifts.
- A diff containing only test files yields no mutation candidates and completes verification rather than failing it. Rules out turning a pure test-refactor into a stranded run.
- Out of scope: whether a surviving *production* mutation should be retryable, and the existing `mutation_repair_exhausted` path.

## Acceptance criteria

- [ ] A changed line in a `*.test.ts` or `*.test.tsx` file produces no mutation candidate.
- [ ] A diff whose changed code paths are all test files completes mutation verification with no surviving-mutation failure.
- [ ] A changed production line in the same diff still produces candidates and still fails when its mutation survives.
- [ ] The exclusion covers `*.test.tsx` and `*.sandbox-unrunnable.test.ts`, proved by fixture paths, not only `*.test.ts`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — gate trust: what mutation verification covers and what it will not flag.

## Prerequisites

- `v2/src/execution/diff-derived-mutation-verifier.ts` — `deriveFromLine`, `isCodePath`, candidate loop
- `v2/docs/operator-runbook.md` § Gate trust — existing `surviving_mutation_failed` recovery guidance
