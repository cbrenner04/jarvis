# No-commit external boundary allows pre-existing siblings

## Problem

Under `modes.plan.commit: false`, `assertNoCommitExternalSpecBoundary`
(`v1/src/modes/plan/boundary.ts:164`) treats the entire project spec root
(`~/.jarvis/specs/<projectId>/`) as the write boundary and flags every top-level
entry that isn't the active `<specDirBasename>`. That root legitimately holds
`ready-intents/` (written by `jarvis intent`) and prior no-commit spec dirs
(never cleaned up), so every plan run after the first false-flags them: prints
`boundary violation detected before draft commit`, appends a `## Blocker` to
`intent.md`, and skips the review pass. The check is mutually exclusive with the
documented `intent → plan` pipeline and with multiple specs per project.

The check must instead verify the agent wrote only *within* the active spec dir
during this run — not that the active spec dir is the sole entry under the
shared root.

## Decisions

- Separate legitimate siblings from escapes by a directory-entry snapshot taken before this run's first write, not a name allowlist — legacy untimestamped prior spec dirs are name-indistinguishable from a rogue dir, so only "existed before this run" reliably separates them.
- Capture the snapshot once (right after the external spec root exists, before the active spec dir or any new sibling is created) and thread the same set into both no-commit external check sites — the pre-commit draft check (`run.ts:1044`) and the fresh review phase (`run.ts:~1241`). A fresh `readdir` at review time cannot tell a new escape from a sibling this run already created.
- Both check sites are on the **fresh** path. The resume review phase runs with `checkBoundary: false` (`run.ts:710`) and passes no `externalSpecRoot`, so no external check runs on resume and there is no capture site there — resume is unaffected by this change. Enabling the external check on resume is out of scope.
- An entry is offending only when it is neither `<specDirBasename>` nor in the snapshot; the active spec dir stays excluded by name.
- A flagged no-commit escape is **not** reverted: `revertPaths` is gated on `commit` (`run.ts:1055`), so in no-commit mode the escape is flagged and blockered but left on disk. The next run's pre-write snapshot then captures it as pre-existing and whitelists it. Disposition: the operator must remove the flagged dir after resolving the blocker; auto-reverting in no-commit mode is out of scope.
- Granularity stays top-level-entry, unchanged from today. Deferred to first consumer: detecting in-place edits to files inside a pre-existing sibling — pin when a caller needs it (external root is not git, no cheap signal). The deferred surface includes `ready-intents/`, a legitimate sibling that is also a consumed `plan` input; undetected edits there could corrupt later `plan` runs.
- Assumes no concurrent `plan` runs over one project root (consistent with the single-operator constraint) — a concurrent run's later-created spec dir would not be in this run's snapshot and would be flagged.

## Task checklist

- [ ] Add a pre-existing-siblings parameter to `assertNoCommitExternalSpecBoundary`; flag an entry only when it is neither the active spec dir nor in that set.
- [ ] Capture the snapshot in `v1/src/modes/plan/run.ts` before the active spec dir is created and thread it into both fresh-path check sites: the pre-commit draft boundary check and the fresh review phase. Resume runs no external check and is untouched.
- [ ] Add unit tests for the new sibling-allowing behavior in `boundary.sandbox-unrunnable.test.ts`.
- [ ] Add/extend an integration test proving a `commit:false` run over a populated external root drafts and reviews cleanly.
- [ ] Update `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `assertNoCommitExternalSpecBoundary` returns `{ ok: true }` when the external spec root contains `ready-intents/` and a prior spec dir that existed before the run, alongside the active spec dir (new unit test in `v1/test/modes/plan/boundary.sandbox-unrunnable.test.ts`).
- [ ] `assertNoCommitExternalSpecBoundary` returns `{ ok: false }` with the offending path when a top-level entry that is neither the active spec dir nor pre-existing is present (new unit test).
- [ ] A `commit:false` plan run whose external spec root already holds `ready-intents/` and a sibling spec dir completes without printing `boundary violation`, appends no boundary `## Blocker` to `intent.md`, and proceeds to the review phase (new/extended integration test in `v1/test/plan-command.sandbox-unrunnable.test.ts`).
- [ ] `git: false keeps external-spec boundary enforcement active` (`v1/test/plan-command.sandbox-unrunnable.test.ts`) stays green — a sibling created *during* the run is still flagged and the run exits `1` (genuine escape preserved).
- [ ] `assertTargetRepoPlanBoundary` tests in `boundary.sandbox-unrunnable.test.ts` stay green (target-repo `spec/` escape detection unchanged).
- [ ] `v1/docs/plan-mode.md` "Write boundary" section states the no-commit external check allows pre-existing siblings (`ready-intents/`, prior spec dirs) and flags only top-level entries created during the run.

## Documentation updates

- `v1/docs/plan-mode.md` — "Write boundary" section: describe the no-commit external check as run-scoped (allows pre-existing siblings, flags new ones).
- `v2/docs/v1-behaviors.md` — update the plan write-boundary entry (currently the bullet sourced to `v1/src/modes/plan/boundary.ts`) so the parity baseline records that the no-commit external check permits pre-existing sibling entries.
