---
name: ready-gate-autocommit-can-commit-regressed-code
---

# The ready gate's dirty-porcelain auto-commit can silently commit regressed code

## Problem

`bun run ready`'s full-tier flow auto-commits and pushes non-empty porcelain
after a green verification (message `chore: apply post-ready verification
output`). Observed live, 2026-07-19, on PR #1791 (`jarvis1 triage --merge`,
trailer `Jarvis-Agent: triage-merge`): this auto-commit landed a change that
**inverted a guard's exclusion condition** (removed a `!` from
`guard-deterministic-daemon-tests.ts`'s `guarded()`), then reported the
run/gate outcome without that regression being caught — the PR stayed draft
only because the *next* invocation happened to re-run the guard against the
inverted logic and surfaced a violation on a `.sandbox-unrunnable.test.ts`
file it should have excluded. The regressed state was, at least transiently,
indistinguishable from a passing gate: the guard's own exclusion-behavior
tests (`guard-deterministic-daemon-tests.test.ts`) passed both before and
after inspection, suggesting the corruption window and the test-execution
window didn't reliably overlap, or the auto-commit mechanism doesn't itself
re-verify after committing dirty output.

The root mechanism (what specifically produced the inverted line — an
autofix misfire, a race between two concurrent gate invocations touching the
same worktree, or something else) is unconfirmed; this seed captures the
reproducible symptom and its severity, not a full diagnosis.

## Decisions

- Investigate whether the pre-verification autofix step
  (`check:fix:unsafe`) or the post-verification dirty-porcelain commit step
  in `scripts/ready.ts` can itself introduce logic changes (not just
  formatting) — rules out assuming autofix is always formatting-only.
- Re-verify (typecheck + test) after any auto-commit of dirty porcelain,
  before reporting the gate green; rules out trusting porcelain content
  without re-running the suite against exactly what was committed.
- If two gate invocations can race on the same worktree (e.g., an operator's
  manual `bun run ready` overlapping a `triage --merge` invocation), guard
  against concurrent writes; rules out assuming single-invocation exclusivity
  without checking.

## Acceptance criteria

- [ ] Root cause identified: which step (autofix, dirty-porcelain commit, or
      a concurrent invocation) produced the inverted condition, with a
      minimal reproduction.
- [ ] The auto-commit-dirty-porcelain step re-verifies (at minimum, re-runs
      the affected test file) after committing, and refuses to report green
      if the committed state doesn't pass; a regression test proves this.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents the finding and
      the fix.

## Documentation updates

- `v2/docs/operator-runbook.md` — record the auto-commit re-verification
  contract once implemented.
