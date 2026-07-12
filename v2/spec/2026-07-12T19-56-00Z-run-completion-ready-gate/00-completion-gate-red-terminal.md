# Make completion-gate red terminal

`jarvis1 run` can currently retry a red completion gate, launch fix-up agents,
and later report success. Completion must instead use the strict shared ready
gate contract already enforced by `jarvis1 triage --merge`.

## Decisions

- Completion invokes one `full` `runReadyAndCommit` gate and accepts its green result only — rules out the completion-only retry loop.
- A red completion gate exits non-zero as `ready-gate-failed` before shrink, review, or draft-to-ready work — rules out fix-up iterations and criteria-only success.
- `triage --merge` retains its existing strict gate and flake-recovery policy — rules out changing merge behavior to accommodate patch completion.
- Remove `readyGateRetryBound` and the red fix-up/stuck-red machinery — rules out a dead configuration and unreachable recovery path.

## Tasks

- [ ] Replace patch completion's retry/loop-back handling with the shared one-pass full gate outcome.
- [ ] Route a red gate to the named terminal reason without emitting successful completion telemetry or promoting the PR.
- [ ] Delete obsolete retry-bound config, fix-up prompt/state, and stuck-red behavior with their tests.
- [ ] Update the durable completion and configuration contracts.

## Acceptance criteria

- [ ] A completed `git: true` patch run exits non-zero with `ready-gate-failed` when its full ready gate is red, and never reports `criteria-complete` as its terminal outcome.
- [ ] The reproduced red-suite path cannot call `gh pr ready` or reach exit `0` after the ready gate fails.
- [ ] A green completed patch run still follows the existing post-completion path, including draft-to-ready behavior when its later gates pass.
- [ ] `jarvis1 triage --merge` still refuses a red local ready gate without merging the PR.
- [ ] `readyGateRetryBound`, completion fix-up iterations, and `ready-stuck-red` are absent from supported patch-run configuration and behavior.
- [ ] `v1/docs/run-loop.md`, `v1/docs/config.md`, `v1/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the one-pass shared completion gate and terminal red result.

## Documentation updates

- `v1/docs/run-loop.md` — completion transition and exit-reason contract.
- `v1/docs/config.md` — remove the retired retry setting.
- `v1/docs/operator-runbook.md` — green gate requirement for `criteria-complete`.
- `v2/docs/v1-behaviors.md` — shared `run` / `triage --merge` gate contract.
