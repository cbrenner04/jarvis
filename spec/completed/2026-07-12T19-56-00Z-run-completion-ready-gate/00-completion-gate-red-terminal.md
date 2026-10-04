# Make completion-gate red terminal

`jarvis1 run` can currently retry a red completion gate, launch fix-up agents,
and later report success. Completion must instead use the strict shared ready
gate contract already enforced by `jarvis1 triage --merge`.

## Decisions

- Completion invokes once the same `full` `runReadyAndCommit` verification primitive as `triage --merge` and accepts green only — rules out a completion-only gate or retry loop.
- A red verification result exits `10` as `ready-gate-failed`; the terminal telemetry outcome and run-summary reason are also `ready-gate-failed`, never `criteria-complete` — rules out retaining `ready-stuck-red` or success telemetry.
- Fix, commit, push, timeout, and residual-dirty gate failures retain their existing operational-failure routing — rules out misclassifying non-verification failures as `ready-gate-failed`.
- The completion gate applies only to `git: true` runs with at least one implementation iteration; `git: false`, zero-iteration/rerun, checkbox-only, and human-only-only completion remain excluded — rules out newly gating already-complete paths.
- Red verification performs no completion fix-up invocation, reset, force-push, discard recovery, ready promotion, or success exit — rules out recovering completion work after a red gate.
- `triage --merge` retains its strict gate and CI-backed flake recovery — rules out extending triage-only recovery to patch completion or weakening merge behavior.
- `readyGateRetryBound` is retired from documented configuration; a saved non-negative integer remains loadable with a deprecation warning and has no effect — rules out rejecting existing valid configs or silently preserving retry behavior.

## Tasks

- [ ] Replace patch completion's retry/loop-back handling with one shared full-gate invocation.
- [ ] Route red verification to terminal exit `10` / `ready-gate-failed` telemetry and summary without successful completion telemetry or PR promotion; preserve operational-failure routing.
- [ ] Delete fix-up prompt/state, reset/force-push/discard recovery, and `ready-stuck-red`; retire `readyGateRetryBound` with legacy-config compatibility.
- [ ] Update the durable completion and configuration contracts.

## Acceptance criteria

- [x] A completed, gated `git: true` patch run with red full-gate verification exits `10`; terminal telemetry and the run summary say `ready-gate-failed`, not `criteria-complete`.
- [x] A red verification result cannot invoke a completion fix-up agent, reset, force-push, discard recovery, `gh pr ready`, or exit `0`.
- [x] Gate operational failures retain their existing non-`ready-gate-failed` routing.
- [x] `git: false`, zero-iteration/rerun, checkbox-only, and human-only-only completion remain outside the completion gate.
- [x] `readyGateRetryBound` remains loadable only as a non-negative-integer legacy field, warns that it is ignored, and never causes retries; docs and config output no longer expose it as supported.
- [x] `v1/test/run.test.ts` `completion ready gate: green gate proceeds to shrink/review with check:fix committed`, `when tree is unchanged, shrink pre-gate runs fast tier`, and `common path with review: one full ready, review final skips on unchanged tree` stay green; `v1/test/modes/patch/pr.test.ts` `recorded green on unchanged tree runs fast tier before gh pr ready` stays green.
- [x] `v1/test/triage-command.test.ts` `--merge recovers on test flake when HEAD-sha CI green and serial probe passes` stays green.
- [x] `jarvis1 triage --merge` still refuses a red local ready gate without merging the PR.
- [x] `v1/docs/run-loop.md`, `v1/docs/config.md`, `v1/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the one-pass shared completion gate and terminal red result.

## Documentation updates

- `v1/docs/run-loop.md` — completion transition and exit-reason contract.
- `v1/docs/config.md` — remove the retired retry setting.
- `v1/docs/operator-runbook.md` — green gate requirement for `criteria-complete`.
- `v2/docs/v1-behaviors.md` — shared `run` / `triage --merge` gate contract.
