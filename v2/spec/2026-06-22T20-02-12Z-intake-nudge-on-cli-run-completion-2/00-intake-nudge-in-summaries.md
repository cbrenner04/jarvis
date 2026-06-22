# Surface intake URL once in run/plan summaries

## Problem

An outside operator working in the terminal has no in-context reminder that harness
friction has a submit path. Surface the canonical `issues/new/choose` intake URL once,
at the lowest-noise spot the operator actually sees: the `run` and `plan` end-of-run
summaries (`runSummary` / `planSummary` in `v1/src/run-summary.ts`).

## Decisions

- One shared exported code constant holds the canonical `issues/new/choose` URL; both summaries reference it — rules out re-hardcoding the URL a fourth time and letting the nudge drift from README/AGENTS/runbook.
- Nudge appended inside `run-summary.ts` so every emit path (telemetry and no-telemetry branches) of both functions carries it once — rules out wiring it at the two call sites, which would duplicate the line and miss the no-telemetry early returns.
- Placement is end-of-run summary only: not the `help` footer, not per-iteration — the summary already gates on having real attempts, so it fires once per completed invocation.
- Scope is `run` and `plan`; `prompt` is excluded (it has no summary surface). Deferred to first consumer: prompt-mode nudge — pin when [[prompt-mode-end-of-run-summary]] lands a summary surface.
- The constant is the only new code home for the URL; README/AGENTS/runbook prose stays as-is (separate shipped behavior) but must match the constant's value.

## Task checklist

- [ ] Add a single shared exported constant for the canonical intake URL in the code path.
- [ ] Append a one-line nudge referencing that constant to the output of `runSummary` and `planSummary`, on both the telemetry and no-telemetry paths.
- [ ] Add/extend tests asserting the nudge appears once in each summary and that `help` output does not contain the URL.
- [ ] Docs updates below.

## Acceptance criteria

- [ ] `run` end-of-run summary output ends with a single line containing the canonical `issues/new/choose` intake URL.
- [ ] `plan` end-of-run summary output ends with a single line containing the canonical `issues/new/choose` intake URL.
- [ ] The nudge URL is read from one shared exported code constant; both `runSummary` and `planSummary` reference that constant rather than a string literal.
- [ ] The URL appears exactly once per emitted summary (telemetry-present and no-telemetry branches both), and `help` output contains no intake URL.
- [ ] `prompt`-mode completion emits no intake nudge.
- [ ] The constant's value equals the URL currently hardcoded in README.md, AGENTS.md, and `v1/docs/operator-runbook.md`.

## Documentation updates

- `v2/docs/v1-behaviors.md`: update the run-summary and plan-summary behavior entries to record that each summary now ends with a one-line intake-URL nudge sourced from a shared constant.
- `v1/docs/run-loop.md` and `v1/docs/plan-mode.md`: note the intake nudge line on the respective end-of-run summaries where summary output is described.
