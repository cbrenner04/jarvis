# Harness installs deps when a worktree's deps change

## Problem

A patch worktree symlinks `node_modules` to the primary checkout (outside the
writable worktree root). When a spec adds an npm dep, neither actuator can
install it: codex `bun add` hits `FailedToOpenSocket` (sandbox network blocked)
plus an empty workspace cache; claude `bun install` hits `EPERM` writing
through the symlink. The added dep never lands, so the next iteration's
typecheck and the ready gate fail. Jarvis must resolve the install itself,
outside the sandbox, only for worktrees whose deps actually change — leaving the
cheap symlink in place for everything else.

## Decisions

- Reactive, not declarative: trigger off an iteration that changed
  `package.json`/`bun.lock`, not a spec frontmatter flag. — rules out making the
  operator pre-mark dep-adding specs.
- On trigger, promote to a real per-worktree `node_modules` via a fresh install
  (atomic per the promotion decision below); do not copy the primary's
  `node_modules`. — rules out copy-then-incremental, which imports the primary's
  drift and adds no correctness gain.
- Install runs in the worktree, invoked by the harness outside the agent
  sandbox (network available there), after the iteration's commit. — rules out
  relying on the agent or the in-sandbox ready gate, both of which are blocked.
- Trigger when any commit landing in the iteration touches `package.json` or
  `bun.lock` — covering all commit paths (subspec commit, WIP-progress,
  WIP-with-blocker), so a WIP dep edit does not leave the next iteration broken.
  — rules out re-installing every iteration (cost), mtime heuristics
  (unreliable), and missing the WIP commit paths.
- The harness commits the post-install `package.json`/`bun.lock` changes itself,
  as a dedicated Jarvis-owned commit, before the ready gate runs. — rules out
  the install's regenerated lockfile landing only on the *next* agent's
  `git add -A` (or never, on the last dep-adding iteration), which would ship the
  PR with a stale/uncommitted lockfile.
- Promotion is atomic: install into a temp directory and swap it into place only
  on install success (or write a success sentinel), so a real `node_modules`
  exists only when the install completed. — rules out a partial directory from a
  failed mid-install being misread as promoted-and-healthy by the resume-skip
  rule.
- Install failure is logged loudly and the run continues, but this is **not** a
  self-healing path: the trigger only re-fires on a later commit re-touching
  `package.json`/`bun.lock`, which post-dep iterations normally don't, so a
  failed install is a dead-end the operator must resolve manually. Continuing
  avoids killing the run mid-flight; it does not recover the install. — rules out
  both aborting the run and the false claim that a failed install self-recovers.
- A dep-adding iteration cannot typecheck/test its own work in-sandbox (the dep
  isn't installed until the post-commit harness step), so verification of that
  work defers to the next iteration, at the cost of one extra loop. Accepted. —
  rules out blocking the iteration on in-sandbox verification that cannot pass.
- Non-dep iterations run no install and touch neither the symlink nor a promoted
  `node_modules`. — preserves the documented out-of-scope guarantee.
- Resume must not re-symlink over an already-promoted real `node_modules`:
  `createWorktreeSymlinks` iterates a configurable symlink set and throws on a
  non-symlink target. Skip **only** the `node_modules` entry when its target is
  already a real directory; other entries still throw on a non-symlink target. —
  rules out both the silent resume crash and suppressing the throw for every
  symlink (which would mask genuine misconfiguration).
- Install command: per-project optional `installCommand`, default `bun install`.
  — rules out hardcoding bun for a harness meant to be repo-agnostic, matching
  the existing per-project `readyCommand` shape.
- Deferred to first consumer: non-bun lockfile trigger detection — pin when a
  non-bun target appears. The trigger set is bun-specific
  (`package.json`/`bun.lock`) though `installCommand` is configurable; acceptable
  under single-operator bun-only scope.
- Resume-skip, `installCommand` config, and logging are coupled guards for the
  install path, not independently verifiable behaviors; one subspec. — rules out
  splitting them into reviewable units that cannot be tested without the install
  path.

## Task checklist

- [ ] After any patch iteration commit (subspec, WIP-progress, WIP-with-blocker),
      detect `package.json`/`bun.lock` change in that commit.
- [ ] On change, atomically promote: install to a temp dir, swap into
      `node_modules` on success only; run outside the sandbox.
- [ ] On install success, harness commits regenerated `package.json`/`bun.lock`
      as a Jarvis-owned commit before the ready gate.
- [ ] In `createWorktreeSymlinks`, skip only the `node_modules` entry when its
      target is already a real directory.
- [ ] Add per-project `installCommand` config (default `bun install`).
- [ ] Log install start/result loudly; continue the run on failure.
- [ ] Docs + v1-behaviors update.

## Acceptance criteria

- [x] After a patch iteration whose commit changes `package.json` or `bun.lock`
      (any commit path), the worktree's `node_modules` is a real directory (not
      the shared symlink) containing the newly added dependency, installed by
      the harness outside the agent sandbox.
- [x] A patch iteration that changes neither `package.json` nor `bun.lock` runs
      no install: on a pre-promotion worktree the `node_modules` symlink stays
      intact; on a promoted worktree the real `node_modules` is untouched.
- [x] After a successful harness install that regenerates the lockfile, the
      post-install `package.json`/`bun.lock` are committed on the branch before
      the ready gate runs.
- [x] Resuming a run whose worktree already has a promoted real `node_modules`
      does not throw and does not attempt to re-create the symlink over it.
- [x] A failed harness install is logged loudly and does not abort the run; the
      completion ready gate still runs.
- [x] `installCommand` is configurable per project and defaults to
      `bun install` when unset.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: document atomic symlink → real
  `node_modules` promotion on dep change, harness lockfile commit, and the
  `node_modules`-only resume skip.
- `v1/docs/run-loop.md`: document the post-iteration harness install step (which
  commit paths fire it, outside-sandbox execution, atomic promotion, harness
  lockfile commit, loud log + continue on failure).
- `v1/docs/config.md`: document per-project `installCommand` (default
  `bun install`).
- `v2/docs/v1-behaviors.md`: record dep-change harness install (atomic promotion,
  harness lockfile commit, deferred in-sandbox verification), and that non-dep
  iterations preserve symlink or promoted `node_modules` unchanged.
