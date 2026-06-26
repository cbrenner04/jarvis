# Clean-tree guard on completion and WIP-progress commits

## Problem

`commitSubspec` and `commitWipProgress` (`v1/src/modes/patch/subspec.ts`) run
`git add -A` then `git commit -F -` unconditionally. When nothing is staged,
`git commit` exits non-zero with `nothing to commit, working tree clean`, the
catch block re-throws, and the whole run aborts (exit 1) — later subspecs never
execute and multi-subspec specs land partially. Intake #547.

The two paths reach a clean tree in different scenarios:

- `commitWipProgress` writes no index file. When a self-committing agent has
  already committed everything (code + ticked criteria), `git add -A` stages
  nothing and the commit aborts. **This is the path that reproduces and fixes
  the literal #547 abort.**
- `commitSubspec` writes the index checkbox flip (`writeFileSync`, line 29)
  *before* `git add -A` (line 32). In the ordinary self-commit case (agent
  commits code, leaves `index.md` `[ ]`), jarvis's own flip stages a real
  change and the commit succeeds normally. `commitSubspec` reaches a clean tree
  **only when the index checkbox is already `[x]`** at commit time — a resumed
  run, or an agent that flipped and committed the index itself.

`commitWipProgressWithBlocker` already guards this: after `git add -A` it runs
`git diff --cached --quiet` and early-returns when nothing is staged
(`status === 0`), surfacing genuine failures only (`status !== 1`). The other
two paths lack the guard.

## Decisions

- Apply the same guard shape as the blocker path to `commitSubspec` and `commitWipProgress`: after `git add -A`, `spawnSync` `git diff --cached --quiet`; `status === 0` → return without committing; `status !== 1` → throw with stderr/stdout detail; otherwise commit as today. Rules out a divergent ad-hoc guard that drifts from the blocker path.
- In `commitSubspec`, the index-checkbox write (`writeFileSync`) and `git add -A` stay before the guard, so a genuine `[ ]`→`[x]` flip is staged and still commits; the guard only short-circuits when the checkbox is already `[x]` and nothing else is staged. Rules out skipping the index write on the clean-tree path.
- Clean-tree return is silent (no throw, no error). The agent self-committing is a tolerated path, not an anomaly to report. Rules out logging it as a warning.
- Genuine `git commit` failures (non-empty-tree) keep the existing catch-and-rethrow with stderr/stdout detail. Rules out the guard swallowing real errors.
- No downstream consumer depends on a per-subspec jarvis commit existing: completion detection reads `HEAD:<spec>`, which on the no-op path resolves to the agent's own commit carrying the checked criteria, so the run continues correctly. No dedicated test required.

## Task checklist

- [ ] Add the `git diff --cached --quiet` guard to `commitSubspec` after `git add -A`.
- [ ] Add the same guard to `commitWipProgress` after `git add -A`.
- [ ] Add tests covering the clean-tree (already-committed) case for both functions.
- [ ] Update docs.

## Acceptance criteria

- [ ] `commitSubspec` returns without throwing when the index checkbox is already `[x]` and `git add -A` stages nothing (resumed run / agent self-committed the index), leaving the index `[x]` on disk.
- [ ] `commitWipProgress` returns without throwing when a self-committing agent has already committed everything and `git add -A` stages nothing.
- [ ] A genuine dirty tree is committed exactly as before by both `commitSubspec` and `commitWipProgress` (existing `subspec.sandbox-unrunnable.test.ts` commit tests stay green).
- [ ] A `git commit` failure that is not the empty/clean-tree case still surfaces as a thrown error from both functions.
- [ ] `commitWipProgressWithBlocker` clean-tree early-return behavior is unchanged.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v1/docs/worktrees-and-commits.md`: note that all three per-subspec commit paths (completion, WIP-progress, WIP-blocker) tolerate an already-committed clean tree and skip the commit rather than aborting the run. Note the attribution consequence: when the guard short-circuits, the subspec's work lives in the agent's own commit, which carries no `Jarvis-Agent` trailer, so that subspec drops out of the rendered PR attribution footer.
- [ ] `v2/docs/v1-behaviors.md`: record that completion and WIP-progress commits, like the WIP-blocker commit, no-op on a clean tree so a self-committing agent never fails the run on a per-subspec commit; note that a no-op'd subspec leaves no `Jarvis-Agent`-trailered commit and so is absent from the PR attribution footer.
