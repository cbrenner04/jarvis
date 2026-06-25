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
- On trigger, replace the `node_modules` symlink with a real per-worktree
  directory via a fresh install; do not copy the primary's `node_modules`. —
  rules out copy-then-incremental, which imports the primary's drift and adds
  code for no correctness gain.
- Install runs in the worktree, invoked by the harness outside the agent
  sandbox (network available there), after the iteration's commit. — rules out
  relying on the agent or the in-sandbox ready gate, both of which are blocked.
- Trigger only when the iteration's commit touches `package.json` or `bun.lock`.
  — rules out re-installing every iteration (cost) and mtime heuristics
  (unreliable).
- Non-dep iterations leave the symlink and run no install. — preserves the
  documented out-of-scope guarantee.
- Resume must not re-symlink over an already-promoted real `node_modules`:
  `createWorktreeSymlinks` currently throws on a non-symlink directory at the
  link path, so promoted worktrees would fail to resume. Skip the symlink when
  the target is already a real directory. — rules out the silent resume crash.
- Install failure logs and continues; it does not abort the run. The downstream
  ready gate/typecheck surfaces genuine breakage. — rules out killing a run on a
  transient network blip.
- Install command: per-project optional `installCommand`, default `bun install`.
  — rules out hardcoding bun for a harness meant to be repo-agnostic, matching
  the existing per-project `readyCommand` shape.

## Task checklist

- [ ] After a patch iteration commit, detect `package.json`/`bun.lock` change.
- [ ] On change, remove the `node_modules` symlink (if present) and run the
      configured install command in the worktree, outside the sandbox.
- [ ] Make symlink setup idempotent on resume against a promoted real
      `node_modules`.
- [ ] Add per-project `installCommand` config (default `bun install`).
- [ ] Log install start/result; continue the run on install failure.
- [ ] Docs + v1-behaviors update.

## Acceptance criteria

- [ ] After a patch iteration whose commit changes `package.json` or `bun.lock`,
      the worktree's `node_modules` is a real directory (not the shared symlink)
      containing the newly added dependency, installed by the harness outside the
      agent sandbox.
- [ ] A patch iteration that changes neither `package.json` nor `bun.lock`
      leaves the worktree's `node_modules` symlink intact and runs no install.
- [ ] Resuming a run whose worktree already has a promoted real `node_modules`
      does not throw and does not attempt to re-create the symlink over it.
- [ ] A failed harness install is logged and does not abort the run; the
      completion ready gate still runs.
- [ ] `installCommand` is configurable per project and defaults to
      `bun install` when unset.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: document symlink → real `node_modules`
  promotion on dep change, and the resume guarantee.
- `v1/docs/run-loop.md`: document the post-iteration harness install step (when
  it fires, that it runs outside the sandbox, failure handling).
- `v1/docs/config.md`: document per-project `installCommand` (default
  `bun install`).
- `v2/docs/v1-behaviors.md`: record that patch worktrees no longer keep a static
  `node_modules` symlink across dep-changing iterations — the harness installs a
  real `node_modules` outside the sandbox when deps change.
