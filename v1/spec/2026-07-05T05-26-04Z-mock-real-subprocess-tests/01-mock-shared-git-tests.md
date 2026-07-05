# Mock shared/git tests

## Problem

`shared/git.sandbox-unrunnable.test.ts` spawns real `git` in `mkdtemp` repos
for every case — redundant once subspec 00 lands.

## Decisions

- Fake `SubprocessRunner` asserts argv (cmd + args + cwd) and returns/throws
  canned results — no real repo.
- Rename to `shared/git.test.ts` when no real process is spawned. The
  `.sandbox-unrunnable` infix is a reviewer signal, not discovery (`test:shared`
  runs all files under `shared/`).

## Task checklist

- [ ] Rewrite as `shared/git.test.ts` with injected fake runner.
- [ ] Remove `shared/git.sandbox-unrunnable.test.ts`.

## Acceptance criteria

- [ ] `shared/git.test.ts` covers local branch exists/doesn't, origin ref
      after fetch, and current branch — no real subprocess.
- [ ] No `shared/git.sandbox-unrunnable.test.ts` remains.

## Documentation updates

- None.
