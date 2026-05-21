# Plan mode prefers detected origin when writing `repo:`

## Problem

`injectRepoLineIntoIndex` in `src/commands/plan.ts:2402` writes a `repo:` line into the generated `index.md` using `const repoValue = project.origin ?? project.key;` (line 2419). When a registered project has no `origin` configured (typical for non-git directories, or for git directories where `jarvis init` did not capture the origin), this fallback emits a bare key. Subspec 00 makes the resolver accept that bare key, so `jarvis run` succeeds — but the resulting spec is **not portable** across machines because the key is meaningful only in the local `~/.jarvis/config.json`.

For registered projects whose `root` is a git checkout with an `origin` remote, plan mode can detect that origin at write time (`git -C <root> remote get-url origin`) and emit it in the `repo:` line, producing a portable spec without requiring the user to re-run `jarvis init`. This is portability hygiene only; subspec 00 is the load-bearing fix and this subspec is explicitly optional and non-blocking.

## Decisions

- **Subspec 00 must land first.** This subspec assumes the resolver already accepts bare keys; do not start this work if subspec 00 is not yet merged.
- **Trigger:** in `injectRepoLineIntoIndex`, when `project.origin` is `undefined`, attempt to read the origin via `git -C <project.root> remote get-url origin`. When `project.origin` is set, behavior is unchanged.
- **Subprocess shape:** non-throwing. Capture stdout/stderr/exit; treat any non-zero exit, missing remote, missing `git` binary, non-git directory, or empty stdout as "no detected origin" and fall back to `project.key`. Use whatever git-invocation utility already exists in `src/commands/plan.ts` (or the closest reused helper). Do not introduce a new git wrapper.
- **Testability via export.** `injectRepoLineIntoIndex` is currently file-private (`src/commands/plan.ts:2402`, no `export` keyword) and has no existing tests (verified by `grep -rln "injectRepoLineIntoIndex" test/`). Export it so the new tests can call it directly. Do not change its signature or behavior beyond the origin-detection change itself.
- **No config mutation.** Do not write the detected origin back to `~/.jarvis/config.json`. Detection is read-only here; persisting that value is a separate concern that belongs to `jarvis init` and is out of scope.
- **Silent failures.** No warnings, no prompts, no thrown errors escape `injectRepoLineIntoIndex`. Plan mode stays non-interactive on this path.
- **No caching.** `injectRepoLineIntoIndex` is called at most twice per plan run (currently `src/commands/plan.ts:1411` and `:1712`). One `git` invocation per call when `project.origin` is undefined is acceptable; do not add memoization just for this.
- **Out of scope:** changing `jarvis init`; persisting the detected origin; consulting any source other than `git remote get-url origin`; back-filling origins for projects that already have `project.origin` set (those continue to win unchanged).

## Task Checklist

- [ ] Modify `injectRepoLineIntoIndex` in `src/commands/plan.ts` so that when `project.origin` is `undefined`, it runs `git -C <project.root> remote get-url origin` (non-throwing) and uses the trimmed non-empty stdout as the `repo:` value. On any failure path (non-zero exit, no `origin` remote, non-git directory, empty stdout, missing `git`), fall back to `project.key`.
- [ ] Export `injectRepoLineIntoIndex` from `src/commands/plan.ts` (it is currently file-private at line 2402). This is the minimum-viable change to make it directly unit-testable; do not refactor the function's signature or behavior beyond what is required for the origin-detection change. There are no existing tests for `injectRepoLineIntoIndex` (verified by `grep -rln "injectRepoLineIntoIndex" test/`); add a new `test/plan-inject-repo-line.test.ts` file (or co-locate cases in `test/plan-command.test.ts` if that fits better with the file's existing shape). Do not introduce a new test harness or new mocking library; reuse the existing test-utils used by sibling `plan-*.test.ts` files (especially the temp-directory / `git init` helpers in `test/plan-end-to-end.test.ts` and `test/plan-worktree.test.ts`).
- [ ] Add 4 unit tests. Each case should exercise `injectRepoLineIntoIndex` against a temp index file and a temp `project.root` directory; use `git init` + `git remote add origin <url>` to construct real-on-disk git states (matching the sibling tests' style) rather than mocking the `git` subprocess:
  1. Project with `origin` set in config → emits `repo: <origin>` (existing behavior preserved; the new `git` call is not made — assert via the written line value, not by spying on subprocess).
  2. Project without `origin` in config, `root` is a git checkout with an `origin` remote (set up with `git init && git remote add origin <url>`) → emits `repo: <detected-origin>`.
  3. Project without `origin` in config, `root` is not a git checkout (empty temp dir) → emits `repo: <project.key>` (fallback preserved; resolver-safe per subspec 00).
  4. Project without `origin` in config, `root` is a git checkout with no `origin` remote (just `git init`, no remote added) → emits `repo: <project.key>` (fallback preserved).
- [ ] Run `bun run typecheck` and `bun test`; confirm both pass.
- [ ] Update `docs/plan-mode.md` (or the nearest existing plan-mode doc) with a short note describing the new write-time origin detection. Keep it brief — this is hygiene, not a feature.

## Acceptance criteria

- [ ] `injectRepoLineIntoIndex` invokes `git -C <project.root> remote get-url origin` only when `project.origin` is `undefined`; the detected non-empty trimmed stdout is used as the `repo:` value.
- [ ] All `git`-invocation failure modes (non-zero exit, missing remote, non-git directory, empty stdout, missing `git` binary) silently fall back to `project.key`. No warning, no prompt, no thrown error escapes `injectRepoLineIntoIndex`.
- [ ] When `project.origin` is set, behavior is unchanged: the configured origin wins and no `git` subprocess is run on this path.
- [ ] No write to `~/.jarvis/config.json` occurs from this code path.
- [ ] `injectRepoLineIntoIndex` is exported from `src/commands/plan.ts` so the new unit tests can call it directly. The function's signature is unchanged apart from this export.
- [ ] The 4 unit tests listed in the task checklist exist and pass under `bun test`. Tests construct real on-disk git state with `git init` (and `git remote add origin <url>` where applicable) rather than mocking the `git` subprocess.
- [ ] `bun run typecheck` passes after the change.
- [ ] `bun test` passes after the change.

## Documentation updates

- [ ] `docs/plan-mode.md` (or the nearest existing plan-mode doc) notes that plan mode prefers a detected `origin` (via `git remote get-url origin` against `project.root`) over the registered project key when emitting the `repo:` line, and that the registered project key remains the final fallback (resolver-safe per subspec 00).
