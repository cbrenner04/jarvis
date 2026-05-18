# 00 - Surface real git error from blocker commits

## Problem

When `commitWipProgressWithBlocker` (and the related commit helpers in `src/modes/patch/subspec.ts`) fail, the thrown `ExecFileSyncError` contains the real git output on `.stderr` and `.stdout` as `Buffer` fields. The catch site in `run.ts` only surfaces `err.message`, which is always `Command failed: git commit -F -` — the underlying git diagnostic (e.g. "nothing to commit") is silently discarded.

A secondary failure mode: if the agent re-emits an identical blocker in a later iteration, `git add -A` stages nothing and `git commit` exits nonzero. The commit is not needed — the blocker is already in HEAD — but the blind error surface makes diagnosis impossible.

## Decisions

- Stderr surfacing applies to `commitSubspec` (line 46), `commitWipProgress` (line 93), and `commitWipProgressWithBlocker` (line 140) in `src/modes/patch/subspec.ts`. All three use `execFileSync` with `stdio: ["pipe", "pipe", "pipe"]` and omit `encoding`, so `.stderr`/`.stdout` are `Buffer | null`.
- Safe extraction: `Buffer.isBuffer(err.stderr) ? err.stderr.toString() : ""`. Append to the rethrown message as `\nstderr: <text>` (skip if empty), plus `\nstdout: <text>` if non-empty.
- The empty-commit guard applies only to `commitWipProgressWithBlocker`. A normal subspec commit with nothing staged is a harness bug and should surface loudly; `commitSubspec` and `commitWipProgress` are left without the guard intentionally.
- Guard implementation: after `git add -A` but before `git commit`, run `spawnSync("git", ["diff", "--cached", "--quiet"], { cwd, stdio: "pipe" })`. Exit 0 → nothing staged → return without committing (caller proceeds normally). Exit 1 → staged changes → proceed to `git commit`. Exit null or > 1 → throw a descriptive error (avoids masking real git failures).
- Add `spawnSync` to the `import { execFileSync }` statement at line 1 of `subspec.ts` — no other import changes needed.
- `run.ts` catch site (lines 1059–1067) already does `err instanceof Error ? err.message : String(err)`. Once `subspec.ts` appends stderr to the rethrown message the detail propagates automatically — no change to `run.ts` needed.

## Tasks

- [ ] In `src/modes/patch/subspec.ts`, add `spawnSync` to the `node:child_process` import.
- [ ] Wrap the `execFileSync` git-commit call in `commitSubspec` (line 46) in a try/catch that appends `err.stderr` and `err.stdout` (both via `Buffer.isBuffer` check) to the rethrown error message.
- [ ] Apply the same stderr/stdout surfacing to `commitWipProgress` (line 93).
- [ ] Apply the same stderr/stdout surfacing to `commitWipProgressWithBlocker` (line 140).
- [ ] In `commitWipProgressWithBlocker`, after `git add -A` and before `git commit`, add a `spawnSync("git", ["diff", "--cached", "--quiet"])` guard: exit 0 → return early; exit 1 → continue; exit null or > 1 → throw with the spawnSync result detail.

## Acceptance criteria

- [ ] When `git commit` fails with "nothing to commit", the error message surfaced to the user includes the git stderr (e.g. `nothing to commit, working tree clean`), not only `Command failed: git commit -F -`.
- [ ] When `commitWipProgressWithBlocker` is called and the blocker content is identical to what is already in HEAD (nothing staged after `git add -A`), the function returns without attempting a commit and the caller proceeds to surface the blocker normally — no error is thrown.
- [ ] When `commitSubspec` or `commitWipProgress` fail, the rethrown error message includes any non-empty git stderr and stdout output.
- [ ] The `spawnSync` exit-null / exit->1 path throws a descriptive error rather than silently returning or swallowing the failure.
- [ ] TypeScript compiles without errors (`npm run build` or equivalent type-check passes).
