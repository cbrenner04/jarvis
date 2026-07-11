# Register the intent workflow

Expose the completed builder and safe completion boundary through the workflow launcher.

## Decisions

- Register `intent` only after its pre-publication validator/landing hook is wired; rule out a runnable preset that can publish unchecked staging output.
- Keep publication at workflow completion: git-enabled runs commit once, push, and open or reuse only an open draft PR matching head and resolved base; rule out step publication, ready transition, or reuse of closed/wrong-base PRs.
- Treat non-fast-forward push as failed publication with retained local state and recovery guidance; rule out force-push or silently rebasing divergent remotes.
- Git-disabled success prints durable intent paths and skips commit/push/PR; rule out a publication prerequisite for local completion.

## Task checklist

- Register the preset and dispatch typed CLI arguments through the builder.
- Connect landed git-enabled output to the existing completion committer/publisher and git-disabled output to the local completion result.
- Add launcher/publication tests and operator documentation.

## Acceptance criteria

- [x] `jarvis run workflow intent --seed <path>` and `--seed-text <text>` send one daemon `start` request only after builder and safe completion registration succeed.
- [x] Unknown/invalid intent arguments and builder failures exit nonzero before daemon contact with terse guidance.
- [x] Git-enabled success creates one completion commit, pushes `intent/<slug>`, and opens or reuses only the matching-base open draft PR with durable `ready-intents/` metadata.
- [x] A non-fast-forward or wrong-base/closed PR state is never destructively reused; publication failure retains local state and names the recovery action.
- [x] Git-disabled success reports durable intent paths and performs no commit, push, or PR operation.
- [x] `v2/src/cli.test.ts` implement-preset cases stay green (behavior unchanged while the registry grows).
- [x] `v2/docs/first-workflow-walkthrough.md` documents both seed forms, precedence/destinations, git and non-git outcomes, branch/worktree/base behavior, single-intent output, failure/resume atomicity, and draft-PR result.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — add the split-only operator path and cross-link the runner contract.
