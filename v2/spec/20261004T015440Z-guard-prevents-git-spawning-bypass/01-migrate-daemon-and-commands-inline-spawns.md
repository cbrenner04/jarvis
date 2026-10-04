# Migrate daemon and commands inline Git spawns

## Problem

After prerequisite migrations, `v2/src/commands/` and `v2/src/daemon/` production modules still construct `runAsync("git", …)` (and any non-boundary `gh` argv) inline. The spawn guard cannot wire into `check` until these paths delegate to `shared/git.ts` or `github-operations.ts`.

## Decision ledger

- In-scope production files: `v2/src/commands/workflow.ts`, `v2/src/commands/init-readiness.ts`, `v2/src/commands/cleanup-archive-publication.ts`, `v2/src/daemon/pipeline-stage-resolve.ts`, `v2/src/daemon/pipeline-execution.ts`; rules out re-migrating `cleanup.ts` (already delegate-only) or touching `v2/src/execution/**` in this slice.
- Prefer existing `shared/git.ts` exports; add typed operations there only when no export covers the argv shape; rules out new parallel git helpers under `v2/src/daemon/`.
- Inline `gh` in this slice (if any) routes through `github-operations.ts`; rules out new `runAsync("gh"` outside `github-operations.ts`.
- Streaming or shell-piped git (none listed in this slice's inventory) uses a `guard-git-spawn-bypass:` marker only when the boundary cannot express the argv without a follow-on shared export; rules out permanent unmarked bypasses.

## Prerequisites

- Subspec [00](./00-guard-git-spawn-bypass-script.md) merged (scanner exists to verify zero violations in this slice).

## Task checklist

- Replace every `runAsync("git"` / `runAsync('git'` in the in-scope files with `shared/git.ts` calls (inject `AsyncSubprocessRunner` + `signal` as today).
- Route any remaining `gh` argv construction in these files through `github-operations.ts`.
- Add or extend co-located tests where behavior changes; preserve soft vs hard error semantics at call sites per `v2/docs/v2-architecture.md` Git operation ownership.

## Acceptance criteria

- [ ] `runGitSpawnBypassGuard` reports zero violations under `v2/src/commands/` and `v2/src/daemon/` production modules; fails against the pre-fix tree where `v2/src/daemon/pipeline-execution.ts` still calls `runner.runAsync("git",`.
- [ ] `pipeline-execution.test.ts` stays green (daemon pipeline git behavior unchanged aside from delegation).
- [ ] `workflow.test.ts` stays green where workflow admission git probes are covered.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None (architecture doc updates in subspec 03).
