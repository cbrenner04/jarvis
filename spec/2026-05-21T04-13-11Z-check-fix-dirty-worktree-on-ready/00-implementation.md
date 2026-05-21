# Auto-commit check:fix mutations before marking PR ready

## Context

`bun run ready` runs `biome check --write .` as its first step. When called from
`maybeMarkReady` in `src/modes/patch/pr.ts:117`, this can leave Biome-reformatted
files uncommitted. The completion-blocker check in `src/worktree.ts:178`
(`worktreeCompletionBlocker`) then sees a dirty worktree, emits the
"spec checklists are complete, but the worktree is not clean" error, and exits 6
— even though the spec is finished.

The fix (Option 1 from the intent): immediately after `bun run ready` succeeds,
detect any dirty state, commit it under `chore: apply pre-ready check:fix` (plus a
`Jarvis-Agent:` trailer), push, then call `gh pr ready`. The `markReady` seam in
`MaybeMarkReadyOpts` is expanded to three independent seams so each step is
testable in isolation without breaking existing tests that stub `markReady`.

## Design decisions

### Three-seam type expansion

```ts
export type MaybeMarkReadyOpts = {
  indexPath: string;
  cwd: string;
  agentLabel?: string;                       // NEW — threaded to Jarvis-Agent trailer
  checkPrExists?: (branch: string, cwd: string) => boolean;
  /** Short-circuit: stubs the entire ready + commit + gh-pr-ready sequence. Existing tests use this unchanged. */
  markReady?: (branch: string, cwd: string) => void;
  /** Seam for just `bun run ready`. Used by new tests when markReady is absent. */
  runReady?: (cwd: string) => void;
  /** Seam for dirty-check, git add -A, git commit, and pushCurrent together. Called only when markReady absent and tree is dirty. */
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
};
```

When `markReady` is present it short-circuits exactly as today (all existing tests
pass). When absent the real implementation runs:
`(runReady ?? realBunRunReady)(cwd)` → dirty-check → `(commitCheckFix ?? realCommitCheckFix)(cwd, agentLabel ?? "")` if dirty → second dirty-check (throw if still dirty) → `gh pr ready <branch>`.

### Commit message

```
chore: apply pre-ready check:fix

Jarvis-Agent: <agentLabel>
```

No `Spec:` body line. `generatePrBodyFromSpec` / attribution footer logic only
surfaces commits whose first body line begins with `Spec:` (see `AGENTS.md:63`),
so this commit is automatically excluded from the per-commit list. The
`Jarvis-Agent:` trailer still counts toward the agent summary line.

### Git command pattern

Follow the exact pattern used in `src/modes/patch/subspec.ts:35-55`:

```ts
execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
execFileSync("git", ["commit", "-F", "-"], {
  cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  input: commitMessage,
});
```

`commitMessage` is `appendAgentTrailer("chore: apply pre-ready check:fix", agentLabel)`.

### Push

Call `pushCurrent({ cwd, firstPush: false })` from `src/worktree.ts:199` immediately
after the commit. The branch already has an upstream at this point (the final
subspec commit was pushed moments before).

### Idempotency guard

After committing, re-run `git status --porcelain`. If still dirty (should never
happen but guards against a broken Biome rule that rewrites on every run), throw:

```
pre-ready check:fix commit succeeded but worktree is still dirty on branch <branch>:
<porcelain output>
Do not call gh pr ready. Inspect the branch and commit or discard the unexpected changes.
```

Do not retry `bun run ready`. One attempt is sufficient.

### `agentLabel` call site

`run.ts:1223` calls `maybeMarkReady` today without `agentLabel`. Add it:

```ts
maybeMarkReady({
  indexPath: specPath,
  cwd: agentWorkingDir,
  agentLabel: agent.attributionLabel(),   // NEW
});
```

### `git: false` mode

`maybeMarkReady` is only called inside the `if (gitEnabled && !opts.skipGhCheck)`
block in `run.ts:1152`. No additional guard is needed.

### Failure handling

- `runReady` throws → propagate as today (no commit, no `gh pr ready`).
- `commitCheckFix` throws → propagate; do not call `gh pr ready`.
- Push inside `commitCheckFix` throws → propagate from `pushCurrent` (same pattern
  as every other push in the harness).

## Tasks

- [ ] Expand `MaybeMarkReadyOpts` in `src/modes/patch/pr.ts` with `agentLabel?`,
      `runReady?`, and `commitCheckFix?` fields, with JSDoc matching the patterns
      used for the existing seam fields.
- [ ] Refactor the default lambda in `maybeMarkReady` to use the three-seam
      sequence: `runReady` → dirty-check → `commitCheckFix` → second dirty-check
      → `gh pr ready`. Keep `markReady` as a short-circuit override when present.
- [ ] Implement `realBunRunReady(cwd)` inline (or as a named `const` inside the
      function body) using the existing `execFileSync("bun", ["run", "ready"], ...)`
      pattern with the same error-capture logic.
- [ ] Implement `realCommitCheckFix(cwd, agentLabel)` inline: `git add -A`,
      `git commit -F -` with `appendAgentTrailer("chore: apply pre-ready check:fix", agentLabel)`,
      second `git status --porcelain` guard, `pushCurrent({ cwd, firstPush: false })`.
- [ ] Add imports to `pr.ts`: `appendAgentTrailer` from `../../commit-trailer.ts`
      and `pushCurrent` from `../../worktree.ts`.
- [ ] Update the `run.ts:1223` call site to pass `agentLabel: agent.attributionLabel()`.
- [ ] Add four tests to `test/modes/patch/pr.test.ts` under `describe("maybeMarkReady")`:
  - (a) All subspecs complete, `runReady` does not dirty the tree → `commitCheckFix`
        seam is not called, no error.
  - (b) All subspecs complete, `runReady` dirties the tree → `commitCheckFix` seam
        is called with correct `cwd` and `agentLabel`.
  - (c) `runReady` seam throws → `commitCheckFix` seam not called, error propagates.
  - (d) `commitCheckFix` seam throws → `gh pr ready` not called, error propagates.
      Use a `ghPrReady` seam (add `ghPrReady?: (branch: string, cwd: string) => void`
      alongside the others, or verify via the existing `markReady` absence pattern).

## Acceptance criteria

- [ ] `MaybeMarkReadyOpts` has `agentLabel?: string`, `runReady?: (cwd: string) => void`,
      and `commitCheckFix?: (cwd: string, agentLabel: string) => void` fields.
- [ ] When `markReady` is absent and `runReady` does not dirty the worktree,
      `commitCheckFix` is not invoked and `gh pr ready` is called normally.
- [ ] When `markReady` is absent and `runReady` dirties the worktree,
      `commitCheckFix` is invoked with the correct `cwd` and `agentLabel` before
      `gh pr ready`.
- [ ] When `markReady` is absent and the worktree is still dirty after
      `commitCheckFix` (the idempotency guard), `gh pr ready` is not called and an
      error is thrown naming the branch and listing the unexpected dirty paths.
- [ ] When `runReady` throws, `commitCheckFix` is not called and the error
      propagates out of `maybeMarkReady`.
- [ ] When `commitCheckFix` throws, `gh pr ready` is not called and the error
      propagates out of `maybeMarkReady`.
- [ ] The `run.ts:1223` call site passes `agentLabel: agent.attributionLabel()`.
- [ ] All existing `maybeMarkReady` tests (including the `markReady` short-circuit
      tests) continue to pass without modification.
- [ ] The four new tests described in the Tasks section all pass.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.
