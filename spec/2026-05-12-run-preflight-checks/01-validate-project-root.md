# 01 - Validate resolved project root exists

## Problem

After `spec/2026-05-12-portable-repo-resolution/` shipped, `src/commands/run.ts`
delegates project resolution to `resolveProject` in
`src/resolve-project.ts`. The resolver returns a `ProjectMatch` whose
`root` may come from:

- a registered project record in `~/.jarvis/config.json` (whose root was
  validated at `jarvis init` time but may have been moved or deleted
  since),
- an ad-hoc walk that finds a `.git` directory at or above the spec, or
- a `--repo` flag value matched against a registered name/origin.

`jarvis run` does not verify that the resolved `root` still exists on
disk before passing it as a `cwd` to subprocesses. When the directory is
gone, the failure surfaces several call sites later — typically inside
`getBaseBranch()` from `src/worktree.ts` — as:

```
failed to create or resume worktree: failed to detect base branch: Error: ENOENT: no such file or directory, posix_spawn 'gh'
```

`posix_spawn` returns `ENOENT` when the child's `cwd` does not exist and
puts the binary name in the message, so the error reads like a `gh`
problem. Combined with subspec 00 (ENOENT-on-spawn translation) the
message becomes worse, not better, because the new wording will say
"gh: binary not found on PATH" for what is actually a missing
project directory. This subspec must therefore land alongside or after
00 to keep the user-facing diagnostics correct.

## Decisions

- After `resolveProject` returns `kind: "ok"` in `src/commands/run.ts`,
  verify that `project.root` is an existing directory (use `existsSync`
  + `statSync().isDirectory()` or `lstatSync` equivalent).
- On failure, exit non-zero with an error that names the path and the
  resolution source. The source is one of:
  - "registered project `<key>`" (resolution path matched a config
    record by name, root, or origin URL)
  - "ad-hoc git checkout discovered from spec location" (resolver walked
    parents and found a `.git`)
  - "spec `repo:` line" (the legacy back-compat branch in
    `resolve-project.ts` lines 56-62, where an absolute `repo:` value
    exact-matched a registered root)
  - "--repo flag value `<value>`"
- The check runs **before** `assertGhReady()` and **before** the
  is-a-git-checkout check at `src/commands/run.ts:133-142`. Otherwise
  those checks will themselves fail confusingly when the root is
  missing (the `.git` check uses `existsSync(join(project.root, ".git"))`
  which simply returns false for a missing root and lands the user on
  the misleading "target is not a git checkout" message).
- The check fires regardless of effective `git` value. Loop-only mode
  uses `project.root` (or `--cwd` override) as the agent's `cwd`.
- No new logic in `resolve-project.ts`; keep that module a pure
  resolver. Validation lives in `src/commands/run.ts` because the error
  message wants to be CLI-shaped.

## Implementation hints

- Plumb the resolution source through. `ResolveResult` currently does
  not carry which step matched. The cleanest options are:
  - extend `ResolvedProject` with a `source: "registered" | "ad-hoc" | "spec-repo" | "repo-flag"` discriminator (the existing `mode: "registered" | "ad-hoc"` is too coarse — it does not distinguish `--repo` from name-based matches), or
  - have `runCommand` track the resolution source at the call site,
    based on which of `repoFlag`, `specRepo`, etc. it passed in.
  Pick whichever keeps the resolver tests stable; either is acceptable.
- The new error pattern should follow the style of the existing
  `formatUnknownRepoError` in `resolve-project.ts:180-190` (named path,
  short reason).

## Task Checklist

- [ ] Add a project-root existence check in `src/commands/run.ts` after
  `resolveProject` succeeds and before any side-effecting work.
- [ ] Surface the resolution source in the error message.
- [ ] Tests in `src/commands/run.test.ts` (or equivalent) covering each
  resolution source: registered-by-name, registered-by-origin, ad-hoc
  git-checkout, `--repo` flag, and the legacy spec-`repo:` exact-match
  branch. Each test asserts non-zero exit, the error text, and that no
  `.worktree/` directory, `git`/`gh` subprocess, agent spawn, or
  session log file is created.
- [ ] Test that the check runs before `assertGhReady` and the
  `.git`-presence check (a missing root with `git: true` should fail
  with the new message, not the "target is not a git checkout" message).

## Acceptance criteria

- [x] A registered project whose `root` no longer exists on disk causes
  `jarvis run` to exit non-zero with a message naming the path and
  identifying the registered project as the source.
- [x] An ad-hoc resolution that lands on a non-existent path (e.g. the
  walk found a `.git` that has since been removed) causes `jarvis run`
  to exit non-zero with a message naming the path and the ad-hoc
  resolution as the source.
- [x] `--repo` matching a registered project whose root no longer
  exists causes the same failure attributed to the `--repo` flag value.
- [x] A spec `repo:` line whose absolute path exact-matches a
  registered root that no longer exists causes the same failure
  attributed to the spec `repo:` line.
- [x] In all cases: no `.worktree/` directory created, no `git` or `gh`
  subprocess invoked, no agent spawned, no session log file opened.
- [x] The check fires regardless of effective `git` value.
- [x] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- `docs/run-loop.md`: add a "Preflight checks" subsection (or extend an
  existing one) listing the project-root existence check and the gh
  auth check (already implemented). Note the ordering: project root,
  then `git: true` ⇒ gh auth + `.git` presence, then worktree setup.
- `docs/spec-guidance.md`: brief note that a `repo:` value (or a
  registered project) pointing at a missing directory produces a named
  error rather than the historical worktree-flavored one.
