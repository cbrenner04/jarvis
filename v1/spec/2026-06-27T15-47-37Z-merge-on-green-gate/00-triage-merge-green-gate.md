# triage --merge: gated admin-squash-merge

## Behavior

Fold the manual `gh pr ready` → `gh pr checks --watch` → `gh pr merge --admin --squash` dance into `jarvis1 triage <worktree-name> --merge`. The flag marks a completed PR ready, then admin-squash-merges it **only after** both gates pass: the local `bun run ready` gate and all CI checks green. On a failing local gate or a red CI check it refuses to merge, leaves the PR unmerged, and reports the specific failing gate/check. The operator still reviews the diff before invoking.

This extends the existing `--mark-ready` recovery flow (preconditions → local ready gate → `gh pr ready`) with a CI-green wait and the admin-merge step.

## Decisions

- Fold into `triage` as a new `--merge` flag; no new subcommand. — north star: extend an existing command's flow.
- `--merge` proceeds when the PR is draft **or** already ready (marks ready if draft, else skips that step); rejects merged/closed PRs. — rules out reusing `--mark-ready`'s draft-only precondition, which would refuse an already-ready PR the operator wants to land.
- Gate order: local `bun run ready` → `gh pr ready` (if draft) → wait for CI green → `gh pr merge --admin --squash`. — rules out merging before local verify, or skipping the local gate on the assumption CI covers it (CI omits `lint:md`).
- Both gates are hard: a failing local gate **or** any red/failed CI check aborts before merge, leaves the PR unmerged, exits non-zero, and reports the specific failing gate/check name. — rules out merging on either gate alone.
- Pending/in-progress CI checks block (wait for resolution) rather than counting as not-green and refusing. — rules out a race where a just-pushed PR refuses because checks haven't started.
- CI state classification (operator-visible via the refusal message): green/pass = `success`, `skipped`, `neutral`; pending (wait) = `pending`, `queued`, `in_progress`, `action_required`, `stale`; red (abort) = `failure`, `cancelled`, `timed_out`, `startup_failure`. — rules out leaving non-success/failure states unmapped, which would mis-bucket `cancelled`/`timed_out` as pending and hang.
- Poll via repeated `gh pr checks --json` (or equivalent JSON query) on a fixed interval, not streaming `gh pr checks --watch`. — `--watch` is a long-lived subprocess incompatible with the `ghRunner` injectable seam; per-poll JSON gives tests a deterministic contract.
- CI-green wait is bounded: poll until resolved or a timeout ceiling (default ~30 min, configurable) elapses; on timeout abort before merge, leave the PR unmerged, exit non-zero, and report the still-pending check name. — rules out hanging indefinitely on a stalled check; pinned now because `--merge` is the first consumer.
- `--merge` and `--mark-ready` together is a usage error (`--merge` subsumes `--mark-ready`). — rules out silently honoring one and ignoring the other.
- Reuse `--mark-ready` preconditions otherwise: worktree exists, PR exists, spec complete, not lock-held by a live run.
- gh/merge interactions are injectable (test seam), matching the `ghRunner`/`prReady` overrides already on `triage --mark-ready`.

## Task checklist

- Parse `--merge` in `v1/src/cli.ts` (help text + usage: requires a worktree name; `--merge --mark-ready` together is a usage error).
- Implement the `--merge` flow in `v1/src/commands/triage.ts`: preconditions (draft relaxed), local ready gate, conditional `gh pr ready`, bounded CI-green poll-wait, admin-squash-merge, refusal reporting.
- Classify CI checks green/pending/red per the Decisions mapping; surface the failing check name on red and the still-pending check name on timeout.
- Tests: green→merge, red-check→refuse, pending→wait-then-resolve, poll-timeout→refuse, local-gate-fail→refuse (draft and already-ready), already-ready→merge, merged/closed→reject, `--merge --mark-ready`→usage, missing worktree-name→usage.
- Documentation updates (below).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree-name> --merge` admin-squash-merges the PR (`gh pr merge --admin --squash`) and exits 0 only after the local `bun run ready` gate passes and all CI checks report green.
- [ ] A red/failed CI check aborts `--merge` before any merge; the PR is left unmerged, the specific failing check name is reported, and the exit code is non-zero.
- [ ] A failing local ready gate aborts `--merge` before any merge, whether the PR starts draft or already ready; the PR is left unmerged, the captured gate failure text is reported, and the exit code is non-zero.
- [ ] Pending/in-progress CI checks cause `--merge` to wait for resolution rather than refusing.
- [ ] CI checks that stay unresolved past the timeout ceiling abort `--merge` before any merge; the PR is left unmerged, the still-pending check name is reported, and the exit code is non-zero.
- [ ] `--merge` proceeds on a PR already in ready (non-draft) state without requiring DRAFT; a merged or closed PR is rejected with a non-zero exit.
- [ ] `--merge` with no worktree name exits with a usage error, mirroring `--mark-ready`; `--merge --mark-ready` together exits with a usage error.
- [ ] Across green→merge, red-check→refuse, pending→wait, poll-timeout→refuse, local-gate-fail→refuse, already-ready→merge, and merged/closed→reject, `--merge` behaves as specified above with no network access (gh interactions injected).

## Documentation updates

- `v1/src/cli.ts`: triage usage/help text documents `--merge`.
- `v2/docs/v1-behaviors.md`: extend the `triage --mark-ready` entry with the `--merge` behavior — gate order, both-gates-hard refusal, bounded CI-green poll-wait (timeout abort), CI state classification, draft-relaxed precondition, merged/closed rejection.
- `v1/docs/operator-runbook.md`:
  - Merging and Manual-finalize-recovery sections: present `jarvis1 triage <worktree-name> --merge` as the gated ready→wait-green→admin-merge path; keep the hand `gh pr merge --admin --squash` only as the last-resort fallback.
  - The gate caveat (the green-CI-poisons-`main` `lint:md` note): `triage --merge` runs the local ready gate (incl. `lint:md`) before merge, closing that gap for the command path; scope the remaining manual `lint:md` warning to direct hand admin-merges that bypass `--merge`.
