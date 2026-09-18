---
name: ready-gate-repair-out-of-diff-edits
---

# Ready-gate repair never strands out-of-diff edits as dirty worktree debris

## Problem

When the ready gate red-fails on files outside the run's diff (e.g. suite-wide contention flakes), the repair loop edits those files — test timeout bumps, `LOAD_SENSITIVE_FILES` additions — and then completion staging refuses them: run `7c4a3663` failed `completion_commit_failed` with "Ready-gate repair stages path outside run diff and spec tree: v2/src/execution/workflow-runner-*.test.ts …". The refusal is correct (out-of-scope edits must not land silently), but the edits are left **uncommitted in the worktree**. Observed 2026-08-28: four merged-PR worktrees each carried stranded dirty band-aids (`120_000` test timeouts in `completion-commit.test.ts`/`diff-derived-mutation-verifier.test.ts`, `LOAD_SENSITIVE_FILES` entries in `scripts/test-slice.ts`), which then made every one of them block `jarvis cleanup` as a dirty worktree until manual `git worktree remove --force`.

Recurred 2026-09-14 (twice), both settling `completion_commit_failed` on the fence: #3894 — the needed fix (drop a now-dead `export` in `query-daemon-lists-from-sockets.ts` after the lane deleted its caller) was outside the diff; #3897 — the gate needed one out-of-diff deletion (`merge-run-lists.ts`, dead export) but repair also edited 35 unrelated files (unused imports, `biome-ignore` removals in `shared/prompts/*`) for warnings that never fail the gate. Both hand-finished. The dominant trigger is a lane deletion orphaning an export in a sibling file.

Recurred 2026-09-16 on #3951 with a worse shape: the only red step was `guard-dead-exports` on `CommitInfo` in `pr-attribution.ts` — a file **inside** the run diff — yet repair left it unfixed and instead edited 36 out-of-diff files (unused-import and lint *warnings* across `shared/prompts/**`, daemon, tests), all refused by the fence. Hand fix was one keyword. Repair is not steered at the failing step's output.

## Decisions

- The staging fence stays: out-of-diff repair edits never land in the completion commit. This seed changes what happens to the refused edits, not the refusal.
- On refusal, the repair edits outside the run diff are reverted in the worktree (the gate already knows the exact paths it refused), so a terminal run leaves a clean tree and cleanup can reclaim it. Rules out leaving debris that wedges cleanup.
- The refusal detail (already naming the paths) also states that the edits were reverted, so the operator knows the gate saw a suite-wide problem worth an operator decision (e.g. a `LOAD_SENSITIVE_FILES` lane join) without archaeology in the worktree.
- Whether the repair loop should be allowed to *propose* such edits (e.g. as a report artifact rather than working-tree changes) is a possible follow-on decided at intent time, not assumed here.
- **Fence policy decided 2026-09-05 (operator): the fence stays absolute — no production bypass, no repair-authored out-of-diff landings.** #3040's dead-end (a repair whose only valid fix is out-of-diff can never succeed, yet the run advertises retryable) is resolved by honest settlement, not wider write authority: the refusal settles the run **non-resumable** with an incident naming the refused paths and what the repair wanted, and the out-of-diff fix becomes an operator decision. Rules out the retryable-forever wedge and rules out repair silently editing shared test infrastructure.
- Also: repair is not steered at the failing step's output (#3951 fixed 36 files for warnings while the one red step went untouched); the repair prompt names the failing gate step and its output, not the whole gate log.

## Acceptance criteria

- [ ] A repair pass that edits a path outside the run diff and spec tree ends with that path clean in the worktree (`git status` empty for it) and the failure detail recording the revert, pinned by a test that fails against the current leave-dirty behavior.
- [ ] In-diff repair edits are unaffected (still staged and committed normally), pinned by an existing or new test.
- [ ] A refusal whose repair edits were entirely out-of-diff settles the run non-resumable with an incident naming the refused paths (the #3040 shape no longer advertises `resume`), pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the completion-failure recovery entry records that refused out-of-diff repair edits are reverted, not stranded.
- `v2/docs/v1-behaviors.md` — record.
