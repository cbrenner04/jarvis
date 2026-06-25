# Verdict — `exit10-verified-green-marks-ready`

The spec's acceptance criteria already describe the correct end behavior, so this is not a case of asserting a falsehood about existing tests. The gap is that the **Decisions and Task checklist under-describe the work the ACs imply** — `--mark-ready` is a new *guarding wrapper* around the completion ready path, not a thin reuse of it. The following refinements are required.

## Required refinements

1. **Frame `--mark-ready` as a guarding wrapper and name every pre-check.** The underlying completion seam's defaults are: throw on no-PR, silent return on incomplete, and call `gh pr ready` with no draft-state check. The spec must add a decision that recovery pre-checks (a) PR existence, (b) PR draft state, and (c) spec completeness *before* invoking the gate — these are not provided by the seam. The **already-ready (not-DRAFT) guard is the real omission**: it appears in no decision or task and has no existing source; it must be named, sourced from the PR's draft state. Express the guard as "promote only when the PR is in DRAFT" so MERGED/CLOSED/open are all covered uniformly.

2. **Disclose the green-path commit-and-push side effect (highest value).** The `full`-tier ready path runs `git add -A`, commits, and pushes the branch when the tree is dirty after fix-up. The intent's premise ("operator already verified green by hand") plausibly leaves a dirty tree, so this side effect will fire. The spec frames triage as read-only with `--mark-ready` as a narrow exception but never states the exception mutates and pushes the operator's branch. The spec must take an explicit position — disclose-and-accept (consistent with run completion) or refuse on a dirty tree — and record it in the `v2/docs/v1-behaviors.md` update.

3. **Define the red/catch boundary.** "Print the captured ready-failure text" assumes a single failure string, but the gate raises multiple distinct failure types (command failure, fix-commit failure, fix-push failure, including a "still dirty — do not promote" case). The spec must state that recovery catches all gate failure modes and maps each to report + non-zero exit, and what counts as "red."

4. **Specify config threading and project-key resolution.** The drill-down path receives no config today; threading the per-project `readyCommand` (AC #3) is a real plumbing change. The spec must name how the project/config key is resolved from a worktree name, since that resolution is the foundation for the override.

5. **Handle `.active-spec-path` edge cases.** Add decisions for: (a) marker absent (pre-marker worktree) → report, do not crash; (b) non-index / single-file spec, where zero linked subspecs reads as "incomplete" and would never promote — state the intended semantics explicitly.

6. **Refuse (or define behavior) when the worktree is held by a live run.** Because this path now mutates and pushes, concurrent execution against a worktree an active `jarvis run` holds can clash. Triage is already lock-aware; the spec should decide to refuse when locked by a live PID.

7. **Minor:** `--mark-ready` with no worktree name should be a usage error (one line).

## Rationale

The intent's goal is a low-friction, *safe* recovery that promotes only verified-green work. Each refinement closes a path where the drafted behavior would either crash, silently no-op, promote incorrectly, or mutate the operator's branch without disclosure — outcomes that contradict the intent and the "guards must match the seam" requirement. Per spec guidance, a spec changing existing v1 behavior must record the new behavior (commit/push disclosure, guards, `readyCommand` honoring) in `v2/docs/v1-behaviors.md`; the side-effect disclosure in particular must land there, not be deferred. The exit-code value and stale-path defensiveness are optional polish, not blocking.