# triage --merge: resolve merge target

## Prerequisites

- Gated `jarvis1 triage <worktree-name> --merge` pipeline (ready gate, CI poll, admin-squash) with injectable `TriageGhRunner` / `ghRunner` seams — the merge-on-green-gate spec.

## Behavior

`jarvis1 triage <target> --merge` accepts a **worktree name** (today), a **spec path**
(`jarvis1 run`-style: index or subspec, relative or absolute), or a **PR reference**
(`#N`, bare `N` when no matching worktree name exists, or a GitHub pull URL). The
positional resolves to the local patch worktree and open PR, then runs the existing
gated merge flow unchanged. Unresolvable or ambiguous targets error clearly; no merge
is attempted. Resolution answers “which worktree?”; post-resolution failures (missing
marker, incomplete spec, lock held, closed PR at merge time) remain the existing
pre-check errors — distinct from unresolvable targets at classification time.

## Decisions

- Scope is `--merge` only; `--mark-ready` and read-only triage forms keep worktree-name-only. — rules out widening recovery/drill-down not named in the intent.
- Resolution must yield a local patch worktree before the gated merge runs; the ready gate executes in that worktree. — rules out admin-merging from `projectRoot` when only a PR number is known.
- Classification order: (1) `.worktree/<arg>` directory exists → worktree name; (2) PR reference (`#N`, `https?://…/pull/N`, bare `N` only when step 1 did not match) → `gh` head ref → worktree whose `HEAD` branch matches; (3) spec-path shape (path separator, or bare `.md` filename for marker scan only) → worktree via union of basename and `.active-spec-path` strategies below. — rules out spec-path shape before PR forms (GitHub pull URLs misclassified) and PR-first lookup breaking numeric worktree names.
- Spec paths resolve relative to **cwd** (same anchor as `jarvis1 run` / `getSpecName`), then normalize to absolute paths for `.active-spec-path` comparison — not relative to `projectRoot`. — rules out silent mismatches from wrong resolution anchor.
- Spec-path worktree lookup unions two strategies, deduped by worktree path: (a) when the input contains a path separator, spec-directory basename names `.worktree/<basename>` if that directory exists; (b) scan each worktree's `.active-spec-path` marker — normalized absolute path equals the normalized input. Bare `.md` tokens without a path separator skip (a) and use (b) only. — rules out parent-dir basename on `index.md` and silent preference when strategies disagree.
- Plan worktrees (e.g. `.worktree/plan-foo/` backing `v1/spec/2026-…-foo/`) resolve through `.active-spec-path` marker match, not basename alone. — rules out basename-only missing timestamped plan spec directories.
- Zero matches: stderr names the input kind and value, exit non-zero, no merge. Multiple distinct worktree matches: stderr lists candidates, exit non-zero, no merge. — rules out silently picking the first candidate.
- `findMatchingOpenPrs` refusal (same semantics as cleanup/triage PR inspection today) applies when a PR reference resolves to a head branch with multiple open PRs (before worktree lookup) and when merge pre-checks find multiple open PRs for the resolved worktree branch. — rules out inventing a new disambiguation policy or omitting the guard at PR-ref resolution.
- `gh` transport/auth failures during PR-ref lookup: stderr reports the failure, exit non-zero, no merge — same fail-closed posture as resolution-time unresolvability. — rules out falling through to merge on `gh` errors.
- After resolution, delegate to the existing `resolveTriageNamedWorktree` / `--merge` pipeline unchanged (pre-checks, gates, CI poll, admin-squash). — rules out re-specifying merge-gate behavior covered by the prerequisite spec.
- PR and worktree scans are injectable for tests (extend existing `TriageGhRunner` / resolver seams). — rules out untestable live `gh` in unit tests.
- Deferred to first consumer: plain `jarvis1 triage <spec-path>` drill-down without `--merge` — pin when an operator asks.

## Task checklist

- Add a `resolveMergeTarget(projectRoot, arg, seams)` helper (new module or `triage.ts` extract) implementing the classification order and ambiguity guards above.
- Wire CLI: pass the positional through resolution when `--merge` is set; keep worktree-name dispatch for read-only and `--mark-ready` forms.
- Update `v1/src/cli.ts` usage/help for the widened `--merge` target.
- Tests: worktree-name path unchanged; spec path via basename (path-separator inputs) and via `.active-spec-path` match (including plan worktree); bare `.md` filename via marker only; PR via `#N`, bare `N`, and URL; zero-match and multi-worktree ambiguity; numeric worktree name wins over PR number; `findMatchingOpenPrs` refusal at PR-ref resolution; `gh` failure during PR lookup; preservation of existing `--merge` gate tests; no network in unit tests.
- Documentation updates (below).

## Acceptance criteria

- [x] `jarvis1 triage <worktree-name> --merge` behavior is unchanged from the merge-on-green-gate spec (existing `triage-command.test.ts` `--merge` cases stay green).
- [x] `jarvis1 triage <spec-path> --merge` resolves the worktree backing that spec (index or subspec path) and admin-squash-merges its open PR when gates pass.
- [x] `jarvis1 triage <pr-ref> --merge` resolves the worktree whose branch heads the referenced open PR and admin-squash-merges when gates pass (`#N`, bare `N`, and `https://github.com/<owner>/<repo>/pull/N` forms).
- [x] An unresolvable target (unknown worktree name, spec with no backing worktree, PR with no local worktree, closed/missing PR at resolution) prints a clear stderr message naming the input and exits non-zero without calling `gh pr merge`.
- [x] An ambiguous target (multiple worktrees match the spec path) prints a clear stderr message listing the candidates and exits non-zero without merging.
- [x] When multiple open PRs share the head branch resolved from a PR reference (or from the resolved worktree branch at merge pre-check), refusal matches existing cleanup/triage `findMatchingOpenPrs` semantics: clear stderr, exit non-zero, no merge.
- [x] `gh` transport or auth failure during PR-reference lookup prints a clear stderr message and exits non-zero without calling `gh pr merge`.
- [x] When a bare integer matches both a worktree directory name and a PR number, the worktree-name interpretation wins and merge proceeds against that worktree's PR.
- [x] `jarvis1 triage --mark-ready <spec-path>` and plain `jarvis1 triage <spec-path>` remain worktree-name-only (spec path without a matching worktree directory name still reports `unknown worktree`).

## Documentation updates

- `v1/src/cli.ts`: triage usage/help documents the `--merge` target forms (worktree name, spec path, PR reference).
- `v2/docs/v1-behaviors.md`: extend the `triage --merge` entry with target-resolution order, accepted PR forms, ambiguity/unresolvable errors, resolution vs post-resolution pre-check failures, and the `--mark-ready`/read-only exclusions.
- `v1/docs/operator-runbook.md`: manual-finalize / merging sections show `jarvis1 triage <spec-path> --merge` (and PR ref) alongside the existing worktree-name example.
