# Parse porcelain paths without aggregate trim

## Problem

`gitStatusPaths` in `v2/src/execution/review-intent-enforcement.ts` trims the full `git status --porcelain --untracked-files=all` buffer before splitting lines. When the first line is unstaged tracked (`<space>M <path>`), that trim drops the leading space, `slice(3)` is offset by one, and the first path character is lost. Git-enabled intent review then false-positives boundary enforcement and stops with `invocation_failure` (`failureKind: "error"`).

## Decisions

- Parse each porcelain line from the raw subprocess output without whole-buffer `.trim()`; rules out aggregate trim plus downstream compensation.
- Split on newlines tolerating a single trailing newline without an empty last entry; strip only trailing `\n`/`\r` per line, never leading whitespace; rules out per-line `trimStart`/`trim()` on the path field.
- Rename lines `XY old -> new` record the destination path after ` -> `; rules out treating the full post-status remainder as one path.
- Staging-dir prefix, verdict file, and owner-marker allowlists in `executeReviewCycleEnforced` stay unchanged; rules out relaxing boundaries to mask the parse bug.
- Unit coverage drives `getChangedPaths` with a mocked `AsyncSubprocessRunner` returning fixed porcelain (no export of `gitStatusPaths` unless a test needs it); rules out live-git fixtures for the first-line offset case.

## Task checklist

- Fix porcelain parsing in `gitStatusPaths`.
- Add unit tests for first-line unstaged, mixed untracked/staged, and rename porcelain.
- Add workflow-runner coverage for allowed staging edits on tracked files and for outside-staging violations with correct paths.
- Update `v2/docs/operator-runbook.md` (boundary violation path wording; drop any intent-review `--review-passes 0` porcelain workaround note).

## Acceptance criteria

- [ ] `review-intent-enforcement.test.ts` test (new) `"git-enabled: getChangedPaths preserves path when first porcelain line is unstaged tracked"` feeds porcelain whose first line is ` M <path>` via mocked `git status` and asserts the returned set contains the full repo-relative path; it fails against whole-output `.trim()` on the status buffer.
- [ ] `review-intent-enforcement.test.ts` test (new) `"git-enabled: getChangedPaths preserves every path for mixed untracked and staged lines"` covers first-line `?? <path>` plus `A  <path>` in one buffer and asserts both paths are intact.
- [ ] `review-intent-enforcement.test.ts` test (new) `"git-enabled: getChangedPaths records rename destination path"` covers `R  old -> new` porcelain and asserts only the destination path is recorded.
- [ ] `workflow-runner.test.ts` test (new) `"completes reviewed-intent review when actuator edits a tracked file under staging"` runs intent review with a git fixture where the actuator modifies a tracked file inside `.jarvis-intent-stage/` and asserts no boundary violation / review completes; it fails on current whole-output `.trim()` behavior.
- [ ] `workflow-runner.test.ts` test (new or extended) asserts an outside-staging modification still fails boundary enforcement and the failure message names the correct unmangled repo-relative path (complements `"restores a reviewed-intent boundary violation in the split workspace"`).
- [ ] Guard inversion: reverting the `gitStatusPaths` parse fix (restoring whole-buffer `.trim()` on status output) turns `"git-enabled: getChangedPaths preserves path when first porcelain line is unstaged tracked"` and `"completes reviewed-intent review when actuator edits a tracked file under staging"` RED.
- [ ] `review-intent-enforcement.test.ts` tests `"git-enabled: getChangedPaths detects an edit outside the staging directory"`, `"git-disabled: getChangedPaths detects an edit outside the staging directory"`, `"git-disabled: getChangedPaths allows edits confined to the staging directory"`, and `"restores a reviewed-intent boundary violation in the split workspace"` in `workflow-runner.test.ts` stay green.
- [ ] `v2/docs/operator-runbook.md` no longer tells operators to use `--review-passes 0` to work around intent-review boundary false positives from porcelain parsing, and states that boundary violation messages list repo-relative paths verbatim.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove intent-review porcelain `--review-passes 0` workaround; document verbatim repo-relative paths in boundary violation messages.
