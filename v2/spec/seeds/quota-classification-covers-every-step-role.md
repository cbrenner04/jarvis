---
name: quota-classification-covers-every-step-role
---

# Quota classification and fallback cover every step role, and a stranded run raises an incident

## Problem

An implement's write steps hit codex's usage limit, classified `quota`, and fell back to cursor correctly — then the same run's `~shrink` step hit the same limit minutes later, classified `error` (`exit_code:1`), got no fallback, and the run settled `paused`/`invocation_error`/`resumable: false`. Because `paused` is not terminal, no operator incident was derived: the sink stayed silent over a stranded workflow with complete, gate-green code and no PR. Evidence: #3372 (homestead-service run `27357953`, telemetry shows `role=implement` quota→cursor three times, `role=shrink` `exit_kind=error` with the codex usage-limit banner in the persisted stderr tail; hand-finished as homestead-service#2).

## Decisions

- Quota detection applies uniformly across step roles — the classifier sees the same stderr heuristics on shrink/review/finalization invocations as on write; rules out per-role classification gaps. (The #3372 tail shows a codex shell-snapshot error line *above* the usage-limit banner; classification must not stop at the first error line.)
- A run that settles with `resumable: false` and no live row derives an operator incident regardless of its non-terminal status; rules out `paused` shapes that strand silently — same class as [[terminal-state-honesty-invariant]].
- Fallback on a mid-workflow step resumes the step, not the workflow; rules out re-running completed write iterations to recover a shrink invocation.

## Acceptance criteria

- [ ] A classification test proves the #3372 stderr shape (noise line, then usage-limit banner) classifies `quota` on a shrink-role invocation and advances the agent order; fails against the current `error` classification.
- [ ] An incident test proves a `paused`/`resumable: false` run with no live row derives an operator incident.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/quota-signals.md` — the multi-line codex tail shape.
- `v2/docs/operator-runbook.md` — stranded-paused incidents.
