# Parse porcelain paths without aggregate trim

## Problem

`gitStatusPaths` in `v2/src/execution/review-intent-enforcement.ts` trims the full `git status --porcelain --untracked-files=all` buffer before splitting lines. When the first line is unstaged tracked (`<space>M <path>`), that trim drops the leading space, `slice(3)` is offset by one, and the first path character is lost. Git-enabled intent review then false-positives boundary enforcement and stops with `invocation_failure` (`failureKind: "error"`).

## Decisions

- Parse each porcelain line from the raw subprocess output without whole-buffer `.trim()`; rules out aggregate trim plus downstream compensation.
- Split on newlines tolerating a single trailing newline without an empty last entry; strip only trailing `\n`/`\r` per line, never leading whitespace; rules out per-line `trimStart`/`trim()` on the path field.
- Extract the path segment after the status columns without `.trim()`/`trimStart` on that segment (replace `line.slice(3).trim()`); rules out path-field trim that strips leading/trailing characters from the recorded path.
- Rename lines `XY old -> new` record the destination path after ` -> `; rules out treating the full post-status remainder as one path.
- Staging-dir prefix, verdict file, and owner-marker allowlists in `executeReviewCycleEnforced` stay unchanged; rules out relaxing boundaries to mask the parse bug.
- Unit coverage drives `getChangedPaths` with a mocked `AsyncSubprocessRunner` returning fixed porcelain (no export of `gitStatusPaths` unless a test needs it); rules out live-git fixtures for the first-line offset case.
- Scope: `review-intent-enforcement.ts` porcelain parsing only; no harness-wide helper in this spec.

## Task checklist

- Fix porcelain parsing in `gitStatusPaths` (no whole-buffer trim; no path-segment `.trim()`).
- Add unit tests for first-line unstaged, mixed untracked/staged, rename porcelain, and path-segment trim behavior.
- Add `workflow-runner.test.ts` coverage via `createIntentWorktreeHarness` / `twoFileIntentWorkflow` (real git split workspace, not `stageReviewedIntent` temp-dir-only patterns): in-place edit on a tracked path under staging completes review; outside-staging violation names correct path.
- Update `v2/docs/operator-runbook.md` (verbatim repo-relative paths in boundary messages).
- Update or retire the porcelain false-positive `--review-passes 0` workaround in `v2/spec/implement-queue.md` (and anywhere else it still documents this defect).

## Acceptance criteria

- [ ] `review-intent-enforcement.test.ts` test (new) `"git-enabled: getChangedPaths preserves path when first porcelain line is unstaged tracked"` feeds porcelain whose first line is `<space>M <path>` via mocked `git status` and asserts the returned set contains the full repo-relative path; it fails against whole-output `.trim()` on the status buffer.
- [ ] `review-intent-enforcement.test.ts` test (new) `"git-enabled: getChangedPaths preserves every path for mixed untracked and staged lines"` covers first-line `?? <path>` plus `A  <path>` in one buffer and asserts both paths are intact.
- [ ] `review-intent-enforcement.test.ts` test (new) `"git-enabled: getChangedPaths records rename destination path"` covers `R  old -> new` porcelain and asserts only the destination path is recorded.
- [ ] `review-intent-enforcement.test.ts` test (new) `"git-enabled: getChangedPaths preserves trailing whitespace in porcelain path segment"` mocks a line whose path segment would change under `line.slice(3).trim()` (e.g. trailing space in the path field) and asserts the returned set records the untrimmed path; it fails while path-segment `.trim()` remains.
- [ ] `workflow-runner.test.ts` test (new) `"completes reviewed-intent review when actuator edits a tracked file under staging"` uses `createIntentWorktreeHarness` / `twoFileIntentWorkflow` (git-initialized split workspace, not non-git reviewed-intent fixtures): staging files are tracked before review, the actuator performs an in-place content change on a tracked path under `.jarvis-intent-stage/` (not a new untracked file), and intent review completes without boundary violation; it fails on current whole-output `.trim()` behavior (first porcelain line `<space>M` on the edited path).
- [ ] `workflow-runner.test.ts` test (new or extended) asserts an outside-staging modification still fails boundary enforcement and the failure message names the correct unmangled repo-relative path (complements `"restores a reviewed-intent boundary violation in the split workspace"`).
- [ ] Guard inversion: reverting the `gitStatusPaths` parse fix (restoring whole-buffer `.trim()` on status output) turns `"git-enabled: getChangedPaths preserves path when first porcelain line is unstaged tracked"` and `"completes reviewed-intent review when actuator edits a tracked file under staging"` RED.
- [ ] `review-intent-enforcement.test.ts` tests `"git-enabled: getChangedPaths detects an edit outside the staging directory"`, `"git-disabled: getChangedPaths detects an edit outside the staging directory"`, `"git-disabled: getChangedPaths allows edits confined to the staging directory"`, and `"restores a reviewed-intent boundary violation in the split workspace"` in `workflow-runner.test.ts` stay green.
- [ ] `v2/docs/operator-runbook.md` states that boundary violation messages list repo-relative paths verbatim (do not require removing unrelated `--review-passes 0` opt-out documentation).
- [ ] `v2/spec/implement-queue.md` no longer documents `--review-passes 0` as the workaround for porcelain parse false boundary violations on git-enabled intent review (update or retire that row/note).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — boundary violation messages list repo-relative paths verbatim.
- `v2/spec/implement-queue.md` — retire or correct the `--review-passes 0` workaround for this porcelain parse defect.
- Skip `v2/docs/v1-behaviors.md` (bug restore; boundary policy and allowlists unchanged).
