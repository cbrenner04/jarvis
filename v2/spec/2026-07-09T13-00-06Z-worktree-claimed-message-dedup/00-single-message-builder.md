# 00 - Single message builder

## Problem

`v2/src/daemon/daemon.ts` builds the string `Worktree already claimed for
project=${key.project}, branch=${key.branch}` independently at 4 call sites
(`DaemonDoubleClaimError` constructor, `checkWorktreeClaimed`, and the two
`hasQueuedRun` checks in `handleWorkflowStart` / `handleWriteLoopStart`).
Nothing guards the copies from drifting apart.

## Decisions

- Add one function, e.g. `worktreeClaimedMessage(key: OwnershipKey): string`,
  next to `ownershipKeyString` in `v2/src/daemon/daemon.ts`; all 4 sites call
  it instead of inlining the template string.
- Wording and fields are unchanged — this is a pure extraction, not a
  behavior change.

## Task Checklist

- [ ] Add the shared message-builder function.
- [ ] Replace all 4 inline template strings with calls to it.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon.ts` contains exactly one string template that
      produces the "Worktree already claimed for project=…, branch=…"
      message; all 4 former call sites invoke it.
- [ ] `v2/src/daemon/daemon-registry.test.ts:67` (`checkWorktreeClaimed`
      `"returns worktree_claimed error when key is claimed"`) stays green —
      this is the test that string-matches the rendered message.
- [ ] `v2/src/daemon/daemon-workflow-start.test.ts`, `daemon-revise.test.ts`,
      and `daemon-start-list.test.ts` `worktree_claimed` cases stay green
      (behavior unchanged by the extraction).

## Documentation updates

None — internal refactor with no operator-visible or behavioral change;
message wording and fields are unchanged, so `v2/docs/v1-behaviors.md` does
not need updating.
