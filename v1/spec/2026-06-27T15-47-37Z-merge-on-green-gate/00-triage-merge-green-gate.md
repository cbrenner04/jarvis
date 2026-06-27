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
- Reuse `--mark-ready` preconditions otherwise: worktree exists, PR exists, spec complete, not lock-held by a live run.
- gh/merge interactions are injectable (test seam), matching the `ghRunner`/`prReady` overrides already on `triage --mark-ready`.

## Task checklist

- Parse `--merge` in `v1/src/cli.ts` (help text + usage: requires a worktree name).
- Implement the `--merge` flow in `v1/src/commands/triage.ts`: preconditions (draft relaxed), local ready gate, conditional `gh pr ready`, CI-green wait, admin-squash-merge, refusal reporting.
- Classify CI checks green/pending/red and surface the failing check name on red.
- Tests: green→merge, red-check→refuse, pending→wait-then-resolve, local-gate-fail→refuse, already-ready→merge, merged/closed→reject, missing worktree-name→usage.
- Documentation updates (below).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree-name> --merge` admin-squash-merges the PR (`gh pr merge --admin --squash`) and exits 0 only after the local `bun run ready` gate passes and all CI checks report green.
- [ ] A red/failed CI check aborts `--merge` before any merge; the PR is left unmerged, the specific failing check name is reported, and the exit code is non-zero.
- [ ] A failing local ready gate aborts `--merge` before any merge; the PR is left unmerged, the captured gate failure text is reported, and the exit code is non-zero.
- [ ] Pending/in-progress CI checks cause `--merge` to wait for resolution rather than refusing.
- [ ] `--merge` proceeds on a PR already in ready (non-draft) state without requiring DRAFT; a merged or closed PR is rejected with a non-zero exit.
- [ ] `--merge` with no worktree name exits with a usage error, mirroring `--mark-ready`.
- [ ] Unit tests cover green→merge, red-check→refuse, pending→wait, local-gate-fail→refuse, already-ready→merge, and merged/closed→reject using an injected gh runner (no network).

## Documentation updates

- `v1/src/cli.ts`: triage usage/help text documents `--merge`.
- `v2/docs/v1-behaviors.md`: extend the `triage --mark-ready` entry (line ~31) with the `--merge` behavior — gate order, both-gates-hard refusal, draft-relaxed precondition, merged/closed rejection.
- `v1/docs/operator-runbook.md`:
  - Merging and Manual-finalize-recovery sections: present `jarvis1 triage <worktree-name> --merge` as the gated ready→wait-green→admin-merge path; keep the hand `gh pr merge --admin --squash` only as the last-resort fallback.
  - The gate caveat (the green-CI-poisons-`main` `lint:md` note): `triage --merge` runs the local ready gate (incl. `lint:md`) before merge, closing that gap for the command path; scope the remaining manual `lint:md` warning to direct hand admin-merges that bypass `--merge`.
