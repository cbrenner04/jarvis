# 03 — Heredoc-free commits

## Problem

`src/modes/patch/subspec.ts` (`commitSubspec`, `commitWipProgress`) and
`src/modes/patch/blocker.ts` (`commitBlocker`) build commit messages by
interpolating subspec content into a bash heredoc and invoke `git commit`
through `shell: "/bin/bash"`. Two concrete defects:

1. If the interpolated content ever contains a line that exactly matches
   the heredoc sentinel (`JARVIS_COMMIT_MESSAGE` for subspec.ts; `EOF` for
   blocker.ts), the heredoc terminates early and the remainder is
   interpreted by bash. This is a shell-injection escape hatch driven by
   spec content. Low probability today, free to eliminate.
2. `blocker.ts` calls `execSync` with no `cwd`. The commands run in the
   parent process's cwd, not the worktree. If `jarvis run` was launched
   outside the worktree (which is the common case — operator runs from the
   project root), the commit lands in the wrong repo or fails.

## Behavior

Replace every heredoc-based commit invocation with:

```ts
execFileSync("git", ["commit", "-F", "-"], {
  cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  input: commitMessage,
});
```

No shell. No heredoc. No escaping concerns. `input` is a Buffer/string that
bun/node pipes to the child's stdin.

`blocker.ts` accepts and forwards a `cwd` argument to every git command it
runs (`git add -A`, `git commit -F -`). Callers (currently none in run.ts;
subspec 04 will add the first real caller) must supply the worktree path.

The same pattern applies to any future commit constructor.

## Tasks

- [ ] Convert `commitSubspec`, `commitWipProgress` to `execFileSync git
      commit -F - input: …`.
- [ ] Convert `commitBlocker` to the same shape and require `cwd`.
- [ ] Audit `src/modes/patch/` and `src/worktree.ts` for any other shelled
      git invocations and convert to `execFileSync` with explicit argv.
- [ ] Tests: a subspec whose body contains the string
      `JARVIS_COMMIT_MESSAGE` on a line by itself commits successfully and
      the full message lands in the commit; a subspec containing `EOF`
      similarly survives the blocker commit path.

## Acceptance criteria

- [ ] No call site uses `shell: "/bin/bash"` or a heredoc to invoke git.
- [ ] `commitSubspec`, `commitWipProgress`, `commitBlocker` all use
      `execFileSync("git", [...], { input })`.
- [ ] `commitBlocker` requires `cwd` and uses it for every child-process
      invocation it makes.
- [ ] Regression test: a subspec containing the literal text
      `JARVIS_COMMIT_MESSAGE` on its own line is committed correctly.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- None required (internal hygiene).
