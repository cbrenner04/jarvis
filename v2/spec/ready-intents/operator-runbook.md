---
name: operator-runbook
---

# Write an operator runbook for the friction that isn't harness-automatable

## Problem

A cluster of recurring session friction is operator/environment discipline, not harness logic —
it gets rediscovered every session because it's written down nowhere. Capture it once as a
runbook so future sessions (human or agent overlord) don't relearn it.

## Scope — what the runbook must cover

Recovery & monitoring patterns that worked:

- **Background-run-and-poll.** Launch `jarvis run` detached and wait on process exit; keeps the
  overlord session dormant/un-billed while the agent works.
- **Integration-merge-then-retest** a behind-`main` branch before merging (cheap insurance).
- **Manual-finalize recovery** (fallback when the harness still stalls): verify isolated +
  full-suite green → tick satisfied ACs → commit → `gh pr ready` → admin-merge. Note this is a
  *last resort* — [[completion-gate-unsafe-lint-convergence]], [[flaky-tests-serial-retry-and-determinism]],
  and #9/#10 should make it rarely needed.

Environment traps:

- **Sandbox blindness & false-negatives.** `ps`/`pgrep` under the sandbox can't see real
  processes — twice misread a live run as a stale lock. The sandbox also produces false *auth*
  failures: `gh auth status` reported an invalid token (blocked keychain) and a `localhost` curl
  returned `000`, both fine unsandboxed. Run all jarvis/git/gh/localhost commands with the sandbox
  off; don't debug an "auth"/"connection" failure before re-checking unsandboxed.
- **Match processes on stable substrings.** A `pgrep` for a relative spec path missed a process
  launched with an absolute path → false "exited."
- **Branch protection + can't self-approve.** Every PR is `BLOCKED` until `gh pr merge --admin`;
  admin-merge is operator-authorized per session. Run `bun run check` before any hand/admin-merge
  — an admin-merge skips the completion gate's lint.
- **`check:fix` vs `check:fix:unsafe`.** Safe `check:fix` leaves `noImplicitAny`/`noExplicitAny`/
  unused-var/non-null-assertion fixes needing `--unsafe` or a hand edit.

Operator-discipline reminders:

- Use the tracked runner, not shell `&` (untracked jobs).
- Branch before editing; never `git reset --hard` over uncommitted work.

## Out of scope

- Anything being automated in the sibling seeds. The runbook documents the *residual* manual path,
  and links to those for the automated path.

## Documentation updates

- This *is* a docs deliverable — land the runbook under `v1/docs/` (e.g. `operator-runbook.md`)
  and link it from the docs index / `AGENTS.md`.

## References

- `session-report.md` §4 (tooling & workflow feedback) — source of these items (the Scope section
  above is self-contained; the report is a local gitignored artifact).

## Prerequisites

- The friction items to document are enumerated in the Scope section above (self-contained).
- `v1/docs/` holds operator-facing docs; `AGENTS.md` is the conventions index.
