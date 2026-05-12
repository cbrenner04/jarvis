# Portable repo resolution and git/gh decoupling

repo: https://github.com/cbrenner04/jarvis

Today every runnable spec must include `repo: <absolute-local-path>`. That is
non-portable (paths differ across machines), leaks personal information when
specs are shared, and tightly couples specs to a single operator's filesystem
layout. Jarvis is also strongly coupled to git/gh: it always creates a
worktree, commits per subspec, pushes, and opens a draft PR — even when the
target work has no business being committed or PR'd from inside jarvis.

This spec moves repo resolution out of the spec body and into jarvis-side
configuration, while making git/gh participation a single boolean toggle
(global, with optional per-project override).

Key decisions, captured here so subspecs can stay focused:

- Specs MAY include `repo:` but it must be a **git URL** (https or ssh) or an
  `owner/repo` slug. The legacy absolute-path form is honored only when it
  exactly equals a registered project's `root`; otherwise it is ignored.
- Resolution order at run time:
  1. `--repo <name|path|url>` CLI flag.
  2. Spec `repo:` URL/slug → loose match against registered projects' `origin`.
  3. Spec lives inside a registered project's `root` → use that project.
  4. Spec lives inside any git checkout (walk up to `.git`) → use that.
  5. Otherwise → interactive prompt listing registered projects; non-TTY
     exits 1 asking for `--repo`.
- `jarvis init` records `origin` URL alongside `root` so URL matching works
  without operator effort.
- Loose URL match: strip protocol, user (`git@`), trailing `.git`, and
  lowercase host + owner/repo.
- New top-level config field `git: boolean` (default `true`). Per-project
  override at `projects[<name>].git`. When effective `git` is `false`: no
  worktree, no commits, no push, no PR; agent runs in resolved project root
  (or `--cwd <dir>` if passed); completion = zero unchecked boxes only.
- `--cwd <dir>` is only valid when effective `git` is `false`.
- Multiple registered projects sharing the same `origin` is legal; loose-URL
  matching that resolves to more than one project triggers the same
  interactive prompt.

## Example: specs co-located in a non-git parent directory

A common layout is a parent directory that holds several related repos plus
the specs that target them:

```text
~/Work/groceries/                 # plain directory, not a git repo
  specs/
    checkout-flow/
      index.md
      00-...md
  groceries-api/                  # git repo
  groceries-client/               # git repo
  groceries-worker/               # git repo
```

Setup:

1. Run `jarvis init` inside each of `groceries-api/`, `groceries-client/`,
   and `groceries-worker/`. Each registers as a project (e.g.
   `groceries/groceries-client`) and records its `origin` URL.
2. Do **not** run `jarvis init` in `~/Work/groceries/` itself; it is not a
   git checkout and has no `origin` to record.
3. Author specs in `~/Work/groceries/specs/<feature>/index.md` with the
   `repo:` line set to the target repo's URL or slug, e.g.
   `repo: https://github.com/you/groceries-client` or `repo: you/groceries-client`.
4. Run from the parent: `jarvis run specs/<feature>/index.md` (cwd can be
   `~/Work/groceries/`).

Resolution: step 2 of the flow above loose-matches the spec's URL against
the registered `origin` and selects the right subdir. Steps 3 and 4 do not
fire because the spec lives outside any registered project and the parent
is not a git checkout — and that is fine.

If the spec omits `repo:`, resolution falls through to the interactive
prompt (subspec 02) listing the registered projects to pick from.

- [x] [00 - Record `origin` URL on init](./00-record-origin-on-init.md)
- [x] [01 - Spec `repo:` URL parsing and resolution flow](./01-repo-url-resolution.md)
- [x] [02 - Interactive disambiguation prompt](./02-disambiguation-prompt.md)
- [ ] [03 - Legacy absolute-path back-compat](./03-legacy-abs-path-compat.md)
- [ ] [04 - `git: true|false` config + per-project override](./04-git-toggle-config.md)
- [ ] [05 - Loop-only mode (no worktree, no commits, no PR)](./05-loop-only-mode.md)
- [ ] [06 - Documentation refresh](./06-docs-refresh.md)
