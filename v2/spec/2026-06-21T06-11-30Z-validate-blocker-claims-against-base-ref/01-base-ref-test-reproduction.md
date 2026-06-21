# 01 — Reproduce cited failures on the base ref

## Problem

Subspec `00` rejects a base-ref-failure blocker claim only when an injected seam
reports the base ref green; with no seam it fail-safes to exit 7. This subspec
provides the production seam: actually run the target repo's test command at the
base ref and return green/red, so validation works outside tests.

## Decisions

- Base ref = the run's base branch via `getBaseBranch` (`v1/src/gh.ts:78`) — the ref patch branches were created from (`v1/src/worktree.ts`). Rules out: diffing against an arbitrary ref.
- Test command = the target repo's `bun run test`, matching the existing patch runner (`v1/src/modes/patch/shrink.ts:252`). Rules out: a bespoke command that could diverge from what shrink/completion run.
- Run in a throwaway git worktree checked out at the base ref; never reset or `git clean` the agent's working dir. Remove the throwaway worktree afterward. Rules out: checking out base in the agent worktree (destroys in-progress edits).
- Green = test command exits 0; any non-zero (including infra/setup failure) is treated as non-green, so `00` fail-safes the blocker to stand. Rules out: rejecting a real blocker because the base-ref harness itself errored.

## Task checklist

- [ ] Implement the base-ref test runner: create a throwaway worktree at the resolved base ref, run `bun run test`, return pass/fail, clean up.
- [ ] Wire it as the default base-ref-run used by `00` when no test seam is injected.
- [ ] Add tests covering green base (blocker rejected end-to-end) and red base (blocker stands).

## Acceptance criteria

- [ ] In a git checkout whose base ref is green, a patch-mode blocker citing pre-existing failures is rejected without any injected seam: the run continues past exit 7 and the `## Blocker` section is removed.
- [ ] In a checkout whose base ref genuinely fails the test command, the same blocker stands and the run exits 7.
- [ ] The base-ref test run executes in a throwaway worktree; the agent's working directory and branch are unchanged afterward (no reset, no clean, no leftover worktree).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — record that base-ref blocker validation runs the target `bun run test` in a throwaway worktree at the base branch (`getBaseBranch`), leaving the agent worktree untouched, and treats any non-zero exit as non-green (fail-safe).
