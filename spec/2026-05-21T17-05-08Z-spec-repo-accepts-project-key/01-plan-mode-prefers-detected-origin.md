# Plan mode prefers detected origin when writing `repo:`

## Problem

`injectRepoLineIntoIndex` in `src/commands/plan.ts:2402` writes `repo: <project.origin ?? project.key>` into the generated `index.md`. When a registered project has no `origin` configured (typical for non-git directories, or for git directories where `jarvis init` did not capture the origin), this fallback emits a bare key. Subspec 00 makes the resolver accept that bare key, so the bug is fixed — but the resulting spec is **not portable** across machines because the key only means something in the local `~/.jarvis/config.json`.

For registered projects whose `root` is a git checkout with an `origin` remote, plan mode could detect that origin at write time (`git -C <root> remote get-url origin`) and emit it in the `repo:` line, producing a portable spec without requiring the user to re-run `jarvis init`. This is portability hygiene, **not** a bug fix; subspec 00 is the load-bearing fix and this subspec is explicitly optional.

## Decisions

- **Subspec 00 must land first.** This subspec is non-blocking and depends on subspec 00 having made the resolver accept bare keys. If subspec 00 is not yet merged, do not start this work.
- **Behavior:** In `injectRepoLineIntoIndex`, when `project.origin` is `undefined`, attempt to read the origin from the project's git checkout via `git -C <project.root> remote get-url origin` (subprocess; non-throwing — capture stdout/stderr, ignore non-zero exit). If a non-empty URL is returned, use it as the `repo:` value. Otherwise fall back to `project.key` (existing behavior, now resolver-safe per subspec 00).
- **No config mutation.** Do not write the detected origin back to `~/.jarvis/config.json`. That is a separate concern (re-running `jarvis init`) and is out of scope. Detection is read-only.
- **Failure is silent.** A non-git project root, a missing `origin` remote, or any `git` invocation failure means: no detected origin → fall back to `project.key`. Do not warn, do not prompt. Plan mode should remain non-interactive on this path.
- **No new dependencies.** Use the existing subprocess machinery in `src/commands/plan.ts` (or the nearest existing utility for running `git` commands). Do not introduce a new git wrapper just for this.
- **Performance:** One `git` invocation per `injectRepoLineIntoIndex` call when `project.origin` is undefined. The function is called at most twice per plan run (at `src/commands/plan.ts:1411` and `:1712`). This is acceptable; no caching needed.
- **Out of scope:** Changing `jarvis init`. Persisting the detected origin into config. Detecting origins for projects that already have `project.origin` set (those values continue to win). Detecting origins via any source other than `git remote get-url origin`.

## Task Checklist

- [ ] In `src/commands/plan.ts`, modify `injectRepoLineIntoIndex` so that when `project.origin` is undefined, it runs `git -C <project.root> remote get-url origin` (non-throwing) and uses the resulting non-empty trimmed stdout as the `repo:` value. On failure (non-zero exit, missing remote, non-git directory, empty stdout), fall back to `project.key`.
- [ ] Add a unit test (in whichever file currently covers `injectRepoLineIntoIndex`; `grep` `injectRepoLineIntoIndex` to locate it — likely `test/plan-*.test.ts`) covering:
  1. Project with `origin` set → emits `repo: <origin>` (existing behavior preserved).
  2. Project without `origin`, `root` is a git checkout with `origin` remote → emits `repo: <detected-origin>`.
  3. Project without `origin`, `root` is not a git checkout → emits `repo: <project.key>` (fallback preserved; resolver-safe per subspec 00).
  4. Project without `origin`, `root` is a git checkout with no `origin` remote → emits `repo: <project.key>` (fallback preserved).
- [ ] If no test file currently covers `injectRepoLineIntoIndex`, add the new cases to the most appropriate existing `plan-*.test.ts` file rather than introducing a new test harness.
- [ ] Run `bun run typecheck` and `bun test` and confirm both pass.
- [ ] Update `docs/plan-mode.md` (or the nearest existing plan-mode doc) noting that plan mode prefers a detected `origin` over the project key when emitting `repo:`. Keep the note short; this is hygiene, not a feature.

## Acceptance criteria

- [ ] `injectRepoLineIntoIndex` in `src/commands/plan.ts` invokes `git -C <project.root> remote get-url origin` only when `project.origin` is `undefined`, and uses non-empty trimmed stdout as the `repo:` value.
- [ ] All `git` invocation failures (non-zero exit, missing remote, non-git directory, empty stdout) silently fall back to `project.key`. No warning, no prompt, no thrown error escapes `injectRepoLineIntoIndex`.
- [ ] Existing behavior when `project.origin` is set is unchanged: the configured origin still wins.
- [ ] No write to `~/.jarvis/config.json` occurs from this code path.
- [ ] The 4 test cases listed in the task checklist exist and pass under `bun test`.
- [ ] `bun run typecheck` passes after the change.
- [ ] `bun test` passes after the change.

## Documentation updates

- [ ] `docs/plan-mode.md` (or the nearest existing plan-mode doc) notes that plan mode prefers a detected `origin` (read from `git remote get-url origin`) over the registered project key when emitting `repo:`, and that the registered project key is still the final fallback (resolver-safe per subspec 00).
