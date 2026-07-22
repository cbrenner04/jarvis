# A `landing_failed` run advertises resume and then refuses it

## Problem

A run that settles `failed` / `landing_failed` reports `retryable: true` and
`nextAction: "resume"` on `run list`. `jarvis run resume <id>` then refuses with
`terminal_run: Cannot resume a failed run` and changes nothing. The row's own remediation is
unreachable, so the operator has no jarvis-native recovery.

Observed 2026-07-22, twice in one batch of seven intent workflows:

```text
d7adb0a1-…  intent/review-actuator-rides-the-iteration-time   failed  landing_failed  true  resume
73da541c-…  intent/write-step-blocks-on-quota-instead-of-ca   failed  landing_failed  true  resume
```

Both runs' write steps had completed (`boundary_committed` → `loop_finished`, `loopOutcomeKind`
`invocation_failure`, `resumable: true`); `~/.jarvis/daemon.log` showed repeated
`gh pr ready: transient network error; retrying (attempt 2/3)` / `(attempt 3/3)` around the same
window. `jarvis run resume` on each returned `terminal_run: Cannot resume a failed run`.

Recovery required `jarvis cleanup --yes --abandon <branch>` and a from-scratch re-run of both
intents — the write step's tokens paid twice. The second run of each succeeded, so the underlying
landing failure was genuinely transient, which is precisely the case `retryable: true` promises to
handle.

Same shape as the already-documented `run resume` gap on `blocked` rows (v2 operator runbook
§ Blocked run), which the runbook resolved by correcting the *documentation*. This one is worse: the
harness itself emits the remediation it will not honor.

## Decisions

- A row's advertised `nextAction` must be one the corresponding command accepts. Either
  `run resume` accepts a `landing_failed` row, or the row stops advertising `resume`. Rules out
  leaving the contradiction and documenting around it.
- Prefer making `landing_failed` genuinely resumable: the write step's work is committed and the
  failure is in publication, which is exactly what resume replays. Rules out demoting the row to
  `retryable: false`, which would make a transient `gh` error cost a full re-run by design.
- Whatever the resolution, pin the row-to-command agreement generically, not for `landing_failed`
  alone — every terminal reason that reports `nextAction: "resume"` must be accepted by
  `run resume`. Rules out a one-reason special case that lets the next reason drift the same way.

## Acceptance criteria

- [ ] A run settled `failed` / `landing_failed` with `retryable: true` and `nextAction: "resume"` is
      accepted by `jarvis run resume` and replays publication from its persisted write snapshot.
- [ ] A test drives that end to end against a failing-then-succeeding publication and asserts the
      resumed run lands its PR without re-running the write step; it fails against the current
      `terminal_run` refusal.
- [ ] A guard pins the general contract: for every terminal reason that reports
      `nextAction: "resume"`, `run resume` does not refuse `terminal_run`. Inverting it fails.
- [ ] Reasons that report `nextAction: "stop"` or `"inspect_spec"` are still refused by
      `run resume`, unchanged — the negative case proves the guard did not make every row resumable.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Publication / completion failures — `landing_failed` is resumable;
  drop any implication that abandon-and-re-run is the recovery.
- `v2/docs/daemon-host.md` — the row-to-command agreement for `nextAction`.
