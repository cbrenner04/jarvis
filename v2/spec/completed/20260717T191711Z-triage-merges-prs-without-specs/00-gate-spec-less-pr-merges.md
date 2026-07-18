# 00 - Gate spec-less PR merges

`jarvis1 triage <target> --merge` resolves its target to a local worktree, but currently refuses before PR inspection and merge gates when the branch has no matching spec. This excludes seed, report, intent, and docs PRs from the command that already enforces the local-ready and CI-green gates.

## Decisions

- Make a missing derived spec optional only for `--merge` after local target resolution; rules out weakening `--mark-ready`, drill-down, or malformed `.active-spec-path` refusals.
- Skip only spec completeness when no spec exists; rules out bypassing the local-ready gate, CI-green wait, draft promotion, or admin-squash merge path.
- Keep completeness unchanged whenever a spec resolves, including the existing `plan/*` exception; rules out treating an incomplete implementation spec as spec-less.

## Work

- Allow merge target resolution to return a worktree and branch without a spec when no marker or branch-derived spec exists.
- Apply completeness only to resolved specs, then use the existing ready, CI, and merge sequence.
- Add focused triage command regression and preservation coverage.
- Align the operator runbooks and v1 behavior catalog.

## Documentation updates

- `v1/docs/operator-runbook.md` Merging: name `triage --merge` as the gated path for seed, report, intent, and docs PRs; remove their manual-fallback carve-out.
- `v2/docs/operator-runbook.md`: remove the spec-less merge gotcha, deleting it if no unsupported merge shape remains.
- `v2/docs/v1-behaviors.md`: record spec-less gated merge behavior and unchanged spec-backed completeness.

## Acceptance criteria

- [x] `jarvis1 triage <target> --merge` accepts a resolved open PR whose branch has no spec, runs the local-ready gate, waits for CI green, and only then admin-squash-merges it.
- [x] A local-ready failure or non-green CI still leaves a spec-less PR unmerged.
- [x] A regression test in `v1/test/triage-command.test.ts` drives `--merge` against a resolved worktree and open PR with no marker or matching spec, asserts both gates precede merge, and fails against the pre-fix `no spec found for branch` refusal.
- [x] `v1/test/triage-command.test.ts` tests `--merge with incomplete spec returns error`, `--merge on plan worktree merges with incomplete subspec AC`, and `--merge corrupted .active-spec-path refuses without branch fallback` stay green.
- [x] `v1/docs/operator-runbook.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the gated spec-less merge path without weakening spec-backed completeness or the manual fallback for genuinely unavailable gates.
