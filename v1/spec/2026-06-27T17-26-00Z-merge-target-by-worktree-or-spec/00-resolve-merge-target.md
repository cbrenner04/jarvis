# triage --merge: resolve merge target

## Behavior

`jarvis1 triage <target> --merge` accepts a **worktree name** (today), a **spec path**
(`jarvis1 run`-style: index or subspec, relative or absolute), or a **PR reference**
(`#N`, bare `N` when no matching worktree name exists, or a GitHub pull URL). The
positional resolves to the local patch worktree and open PR, then runs the existing
gated merge flow unchanged. Unresolvable or ambiguous targets error clearly; no merge
is attempted.

## Decisions

- Scope is `--merge` only; `--mark-ready` and read-only triage forms keep worktree-name-only. — rules out widening recovery/drill-down not named in the intent.
- Resolution must yield a local patch worktree before the gated merge runs; the ready gate executes in that worktree. — rules out admin-merging from `projectRoot` when only a PR number is known.
- Classification order: (1) `.worktree/<arg>` directory exists → worktree name; (2) spec-path shape (path separator or `.md` suffix) → worktree via spec-directory basename (`getSpecName`) then `.active-spec-path` scan across worktrees; (3) PR reference → `gh` head ref → worktree whose `HEAD` branch matches. — rules out PR-first lookup breaking numeric worktree names.
- Spec-path equality uses normalized absolute paths; subspec inputs match when their spec-directory basename names an existing worktree or when a worktree's `.active-spec-path` marker normalizes to the same file. — rules out brittle string equality on relative vs worktree-local absolute markers.
- Zero matches: stderr names the input kind and value, exit non-zero, no merge. Multiple worktree matches: stderr lists candidates, exit non-zero, no merge. — rules out silently picking the first candidate.
- Multiple open PRs for the resolved branch reuse existing `findMatchingOpenPrs` refusal (same semantics as cleanup/triage PR inspection today). — rules out inventing a new disambiguation policy.
- After resolution, delegate to the existing `resolveTriageNamedWorktree` / `--merge` pipeline unchanged (pre-checks, gates, CI poll, admin-squash). — rules out re-specifying merge-gate behavior covered by the prerequisite spec.
- PR and worktree scans are injectable for tests (extend existing `TriageGhRunner` / resolver seams). — rules out untestable live `gh` in unit tests.
- Deferred to first consumer: plain `jarvis1 triage <spec-path>` drill-down without `--merge` — pin when an operator asks.

## Task checklist

- Add a `resolveMergeTarget(projectRoot, arg, seams)` helper (new module or `triage.ts` extract) implementing the classification order and ambiguity guards above.
- Wire CLI: pass the positional through resolution when `--merge` is set; keep worktree-name dispatch for read-only and `--mark-ready` forms.
- Update `v1/src/cli.ts` usage/help for the widened `--merge` target.
- Tests: worktree-name path unchanged; spec path via basename and via `.active-spec-path` match; PR via `#N`, bare `N`, and URL; zero-match and multi-worktree ambiguity; numeric worktree name wins over PR number; preservation of existing `--merge` gate tests; no network in unit tests.
- Documentation updates (below).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree-name> --merge` behavior is unchanged from the merge-on-green-gate spec (existing `triage-command.test.ts` `--merge` cases stay green).
- [ ] `jarvis1 triage <spec-path> --merge` resolves the worktree backing that spec (index or subspec path) and admin-squash-merges its open PR when gates pass.
- [ ] `jarvis1 triage <pr-ref> --merge` resolves the worktree whose branch heads the referenced open PR and admin-squash-merges when gates pass (`#N`, bare `N`, and `https://github.com/<owner>/<repo>/pull/N` forms).
- [ ] An unresolvable target (unknown worktree name, spec with no backing worktree, PR with no local worktree, closed/missing PR) prints a clear stderr message naming the input and exits non-zero without calling `gh pr merge`.
- [ ] An ambiguous target (multiple worktrees match the spec path) prints a clear stderr message listing the candidates and exits non-zero without merging.
- [ ] When a bare integer matches both a worktree directory name and a PR number, the worktree-name interpretation wins and merge proceeds against that worktree's PR.
- [ ] `jarvis1 triage --mark-ready <spec-path>` and plain `jarvis1 triage <spec-path>` remain worktree-name-only (spec path without a matching worktree directory name still reports `unknown worktree`).

## Documentation updates

- `v1/src/cli.ts`: triage usage/help documents the `--merge` target forms (worktree name, spec path, PR reference).
- `v2/docs/v1-behaviors.md`: extend the `triage --merge` entry with target-resolution order, accepted PR forms, ambiguity/unresolvable errors, and the `--mark-ready`/read-only exclusions.
- `v1/docs/operator-runbook.md`: manual-finalize / merging sections show `jarvis1 triage <spec-path> --merge` (and PR ref) alongside the existing worktree-name example.
