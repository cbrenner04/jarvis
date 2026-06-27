# External source-spec reset on re-run

## Problem

A `commit:false` run mutates the external source spec in `~/.jarvis/specs/<proj>/`
in place — ticking acceptance-criteria checkboxes and possibly appending a
`## Blocker`. The existing no-commit auto-reset (`no-commit-delta.ts` +
`iteration.ts`) already records a per-run delta and reverts those mutations
before the next agent invocation, but its create/reset/record sites are all
gated on `!gitEnabled` (`iteration.ts:514`, `:522`, `:984`, `:1022`).
`gitEnabled` comes from config (`effectiveGit`), defaults `true`, and is
orthogonal to the plan-mode `commit:false` setting. So an external spec run
under the default `git:true` mutates a file outside the worktree that git never
reverts *and* the delta reset never fires — re-running an incomplete item is not
idempotent.

## Decisions

- Trigger reset on spec-path externality (active spec resolves outside the agent working tree), not on a config flag — rules out keying on plan `commit:false`, which is orthogonal, invisible at patch run time, and an external spec may be run under any `git` setting.
- Detect externality with the same predicate preflight already uses (`specOutsideWorktreeReadDirs`: `relative(agentWorkingDir, specPath)` starts with `..` or is absolute) — rules out re-deriving a divergent rule.
- Apply reset for external specs even when `gitEnabled` is true — rules out leaving the bare `!gitEnabled` guard, which skips external specs under the default `git:true`.
- Reuse the existing delta verbatim (keyed on spec-path hash; un-tick recorded AC, strip recorded blocker, preserve pre-attempt checkboxes). The external spec path is naturally distinct from any in-repo path, so no key collision.

## Task checklist

- [ ] Introduce an "untracked mutation" condition (`!gitEnabled || spec is external`) and use it for the delta create/reset gate and the AC/blocker record gates in `iteration.ts`.
- [ ] Compute externality from the active spec path vs. the agent working dir, reusing preflight's predicate logic.
- [ ] Add tests covering an external spec run under `git:true`: prior-run AC un-ticked, appended blocker dropped, pre-attempt checkboxes/blocker preserved, in-repo `git:true` spec untouched.
- [ ] Documentation updates below.

## Acceptance criteria

- [x] Re-running an external `commit:false` source spec under `git:true` un-ticks acceptance criteria ticked by the prior incomplete run before the next agent invocation.
- [x] Re-running an external `commit:false` source spec drops the `## Blocker` that the prior incomplete run appended.
- [x] Acceptance criteria ticked before any run (pre-attempt) stay ticked through the reset.
- [x] An in-repo spec run under `git:true` triggers no delta reset (existing behavior preserved): its acceptance criteria and blockers are left as committed.
- [x] Existing `v1/test/no-commit-delta.test.ts` stays green (the un-tick / strip-blocker / preserve-pre-attempt mechanism is unchanged).
- [x] A new test exercises an external spec path resolved outside the agent working tree with `gitEnabled` true and asserts the prior-run delta is reset on re-run.

## Documentation updates

- `v1/docs/operator-runbook.md` "No-commit re-run auto-reset" — state external `commit:false` source specs are covered, including when the run itself uses git.
- `v1/docs/config.md` `modes.plan.commit` `false` notes — re-runs of external specs are self-cleaning (no hand-reverting ticks or blockers).
- `v2/docs/v1-behaviors.md` — extend the existing "No-commit re-run auto-reset" entry: reset scope is now spec-path externality (mutations git never reverts), not `!gitEnabled` alone.
