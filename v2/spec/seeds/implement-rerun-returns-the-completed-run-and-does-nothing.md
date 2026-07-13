# Re-running `implement` on a spec returns the prior completed run and does nothing

`jarvis run workflow implement` on a spec whose branch already has a `completed` run row
**starts no run at all**. It prints the *old* run's id and exits 0. The operator sees a UUID and
a success exit; the daemon did nothing.

## Problem

Observed 2026-07-13T22:12Z. Fresh daemon (restarted on current `main`):

```sh
jarvis run workflow implement --base main \
  --spec v2/spec/20260713T193047Z-blocked-run-retains-worktree-and-branch/index.md
# → f9d556ed-7bcc-466f-b3f7-7a7c4576c3ac   (exit 0)
```

`f9d556ed` is the run from **19:37Z**, three hours earlier — the run named in
`implement-reports-done-with-unticked-criteria`. `jarvis run log f9d556ed` ends at 19:44:08Z
with `loop_finished`; **no new event was appended**, `jarvis run list` shows it `completed` /
`not-live`, and no new run row exists. Nothing was invoked.

Mechanism, `v2/src/execution/workflow-runner.ts` — `prepareWorkflowStep` resolves the step's
run by `store.findRunByProjectBranch({ project, branch })` and short-circuits:

```ts
if (existingRun?.status === "completed") {
  return { kind: "completed", runId: existingRun.id };
}
```

The implement branch defaults to the spec directory basename, so the key is effectively the
spec. This is workflow-step idempotence — correct *within* one workflow's resume, wrong as the
response to a **new operator request**. There is no way to re-run a spec through v2 implement:
the state store, not the spec, decides the step is done.

The two P0s compound. `implement-reports-done-with-unticked-criteria` lets a run reach
`completed` with 0/5 criteria ticked and nothing committed; this defect then makes that spec
**permanently unrunnable** through v2 — every retry silently replays the lie. The operator's
only recovery is a different `--branch` or hand-editing `~/.jarvis/state/v2.sqlite`.

Same family as the rest of the session's findings: a terminal status asserted, and here also
*trusted*, without the evidence that would substantiate it.

## Decisions

- **A new operator `run workflow` request always starts a run.** Step idempotence belongs to
  workflow resume, not to CLI dispatch. Rules out keying a fresh request off a prior run's
  durable status.
- **If a spec is genuinely complete, say so and exit non-zero** — do not hand back a stale run
  id that reads as success. The operator must be able to distinguish "already done" from
  "started".
- **Completeness is read from the spec, not the run row.** A `completed` row on a spec with
  unticked acceptance criteria must not suppress work.

## Prerequisites

- None. Pairs with `implement-reports-done-with-unticked-criteria`; either can land first, but
  neither alone restores a trustworthy implement path.

## Out of scope

- Resume semantics for a genuinely in-flight (`in-progress`, `revising`, `awaiting-human`)
  run — those branches of `prepareWorkflowStep` are not implicated.
- `intent` / `plan` presets — not observed, though they share `prepareWorkflowStep`.

## Documentation updates

- `v2/docs/operator-runbook.md` § Known gotchas — a re-requested implement on a spec with a
  completed run is a silent no-op; check the returned run id against `run list` timestamps.
  Delete the bullet when this ships.
- `v2/docs/workflow-runner.md` — document that a CLI request creates a run unconditionally.
