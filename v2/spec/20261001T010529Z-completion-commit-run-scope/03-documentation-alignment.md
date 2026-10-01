# Operator and parity documentation

## Problem

Harness commit scope enforcement and stale-main refusal change operator expectations and v2/v1 parity catalog entries; without doc alignment, reviewers still treat pre-merge lane diffs as the only guard.

## Decisions

- Document scope enforcement and stale-main refusal in `v2/docs/write-behavior.md` at the existing completion-commit / per-iteration commit sections — rules out a new standalone doc file duplicating `write-behavior.md`.
- Describe enforcement as centralized in `createCompletionCommitter` for harness commits that use it; [02-harness-commit-entrypoints-pin-scope.md](02-harness-commit-entrypoints-pin-scope.md) pins are regression guards for named entrypoints, not proof every call chain is individually exercised — rules out operator docs implying exhaustive per-path verification.
- State that `commit_scope_violation` is emitted only when both `logSink` and `runId` are on `CompletionCommitInput`; violations still revert either way — rules out docs implying always-on run-log events.
- `v2/docs/operator-practices.md` states that post-land harness commits enforce run scope automatically and pre-merge lane diff against merge base remains a sanity check, not the primary guard — rules out removing the pre-merge diff habit entirely.
- `v2/docs/v1-behaviors.md` records v2 harness commit scope enforcement and stale-main refusal for parity review — required because this changes existing harness behavior.

## Tasks

- Update `v2/docs/write-behavior.md` for commit scope check, conditional `commit_scope_violation`, derivation fail-closed, and stale-main refusal on harness commits that use `createCompletionCommitter`.
- Update `v2/docs/operator-practices.md` per decisions above.
- Add `v2/docs/v1-behaviors.md` catalog bullets for scope enforcement and stale-main refusal.

## Acceptance criteria

- [ ] `v2/docs/write-behavior.md` describes run-scope allowset sources (including repair-fence precedence), derivation fail-closed, out-of-scope revert + conditional `commit_scope_violation`, empty-remainder no-progress semantics, stale-main blob refusal, and notes entrypoint pins in 02 as regression coverage.
- [ ] `v2/docs/operator-practices.md` states harness commits enforce run scope after this work lands, `commit_scope_violation` requires run log wiring, and pre-merge lane diff against merge base remains a sanity check.
- [ ] `v2/docs/v1-behaviors.md` catalogs harness commit scope enforcement and stale-main refusal.

## Documentation updates

- `v2/docs/write-behavior.md` — commit scope check, conditional `commit_scope_violation`, derivation fail-closed, stale-main refusal, and qualification of 02 entrypoint pins.
- `v2/docs/operator-practices.md` — harness commits enforce run scope automatically after land; pre-merge lane diff against merge base remains a sanity check; run-log emission requires `logSink`+`runId`.
- `v2/docs/v1-behaviors.md` — catalog harness commit scope enforcement and stale-main refusal.
