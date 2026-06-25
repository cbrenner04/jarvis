# Verdict — `dep-adding-specs-install-unattended`

The mechanism (reactive, dep-change-triggered harness install promoting the symlink to a real `node_modules`) is sound and the ledgers are disciplined. But the spec is **not yet implementable**: a correctness hole ships broken PRs, and several decisions assert safety properties the design doesn't deliver. Required refinements below.

## Blocking

1. **Who commits the install's lockfile output.** The harness install runs *after* the iteration's commit and regenerates `bun.lock`. On the last dep-adding iteration nothing re-commits it, so the ready gate runs against — and the PR ships with — an uncommitted/stale lockfile. The spec has no decision or AC covering this. Add a decision establishing that the harness commits the post-install `package.json`/`bun.lock` changes (with a Jarvis-owned commit, not folded into the agent's next `git add -A`), plus an acceptance criterion asserting the post-install lockfile reaches the branch before the ready gate runs.

## Must specify

2. **"Continue on failure" overstates its safety.** The decision justifies continuing past install failure as surviving "a transient network blip," but the trigger only re-fires when a later commit re-touches `package.json`/`bun.lock`, which post-dep iterations normally don't — so a failed install is a silent dead-end, not graceful degradation. Either add retry-within-the-step behavior, or keep continue-on-failure but rewrite the rationale to state the truth (operator must intervene; failure is logged loudly) and drop the "transient blip" framing. The decision must not claim a recovery property the design lacks.

3. **Partial `node_modules` after a failed mid-install.** Removing the symlink then installing can leave a partial real directory. The resume-idempotency rule ("already a real directory → skip the symlink") would misread that partial state as promoted-and-healthy — the good and broken states are indistinguishable. Add a decision making promotion atomic (e.g., install to a temp dir and swap on success, or a success sentinel) so a real `node_modules` exists only when complete. This is coupled to #2.

4. **Which commit paths fire the install.** There are distinct commit paths (subspec commit, WIP progress, WIP-with-blocker). "After a patch iteration commit" doesn't say which trigger. State explicitly that any commit landing a `package.json`/`bun.lock` change fires the install (so a WIP dep edit doesn't leave the next iteration broken), naming the paths covered — this affects both correctness and cost.

5. **Scope the resume-skip to `node_modules`.** `createWorktreeSymlinks` iterates a configurable symlink set and throws on a non-symlink target for any of them. The idempotency decision as worded ("when the target is already a real directory") would suppress that throw for *every* symlink, masking genuine misconfiguration. Scope the skip to the `node_modules` entry specifically.

## Clarify (prevent implementer guesses)

6. **Deferred verification.** A dep-adding iteration can't typecheck/test its own work in-sandbox; verification defers to the next iteration at the cost of one extra loop. This is implied by the post-commit architecture but never stated. Record it as an explicit accepted-cost decision in subspec 00.

7. **Non-bun trigger is hardcoded.** `installCommand` is configurable but the trigger set is bun-specific (`package.json`/`bun.lock`). Per single-operator, bun-only scope this is acceptable now, but name the limitation rather than leave the inconsistency unacknowledged — record it as `Deferred to first consumer: non-bun lockfile trigger detection — pin when a non-bun target appears`.

8. **AC #2 contradiction post-promotion.** After promotion there is no symlink to "leave intact," so AC #2 reads as a contradiction on a promoted worktree. Scope it: a non-dep iteration on a pre-promotion worktree leaves the symlink intact; on a promoted worktree it leaves the real `node_modules` untouched and runs no install.

9. **Subspec 00 atomicity.** The five concerns (change-detection, symlink-removal+install, resume fix, config, logging) are one behavior plus its required guards; the resume fix and config are dead code without the install path. Keeping them in one subspec is correct — add the deliberate note that the resume fix and `installCommand` config exist only to serve the install path and aren't independently verifiable, so the reader understands the coupling.

## No action

- ACs naming `installCommand`, `patch.rules`, and `revision` are legitimate — these are harness subspecs where structure is the contract.