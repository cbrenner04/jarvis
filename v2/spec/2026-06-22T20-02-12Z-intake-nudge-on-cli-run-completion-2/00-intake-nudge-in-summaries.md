# Surface intake URL once in run/plan summaries

## Problem

An outside operator working in the terminal has no in-context reminder that harness
friction has a submit path. Surface the canonical `issues/new/choose` intake URL once,
at the lowest-noise spot the operator actually sees: the `run` and `plan` end-of-run
summaries (`runSummary` / `planSummary` in `v1/src/run-summary.ts`).

## Decisions

- One shared exported code constant holds the canonical `issues/new/choose` URL; both summaries reference it — introduces the single code-side home for the URL and keeps the four prose copies (README, AGENTS, CLAUDE.md, runbook) in sync with it. Rules out a fifth string literal that could drift. The constant must be importable by `run-summary.ts`.
- The nudge is appended at **every** summary emission site, not gated on a branch. `run-summary.ts` has four distinct return sites that emit summary text: the shared render's zero-records early return, the render's final return, and `runSummary`'s and `planSummary`'s own no-telemetry early returns. Append the nudge so each of the four carries it once — rules out the binary "telemetry vs no-telemetry" framing, which leaves the zero-records render uncovered and breaks the "summary ends with the URL" contract for empty-record runs.
- Once-per-invocation is guaranteed by the **call sites**, which gate on whether any agent/telemetry writes occurred — not by anything inside the render. The render emits unconditionally; relocating the rationale here prevents a future change from removing the real call-site gate on the false belief the render self-gates.
- Placement: not the `help` footer, not per-iteration. The nudge is a single distinct line, appended after all existing trailing output (after any `notes:` block on the render path, and after the trailing `(no telemetry records found for this run)` line on the no-telemetry paths).
- Scope is `run` and `plan`; `prompt` is excluded (it has no summary surface). Deferred to first consumer: prompt-mode nudge — pin when [[prompt-mode-end-of-run-summary]] lands a summary surface.

## Task checklist

- [ ] Add a single shared exported constant for the canonical intake URL, importable by `run-summary.ts`.
- [ ] Append the one-line nudge referencing that constant at all four summary return sites in `run-summary.ts` (zero-records render, final render, and the two no-telemetry early returns), positioned as the last line of each summary.
- [ ] Add a check (test or scripted assertion) that the constant value equals the URL hardcoded in README.md, AGENTS.md, CLAUDE.md, and `v1/docs/operator-runbook.md`. (If left to manual review instead, convert this item to an explicit manual-review checklist item.)
- [ ] Tests: nudge appears exactly once and last in each summary, including the zero-records render and the no-telemetry paths; `help` output contains no intake URL; prompt exit paths emit no nudge.
- [ ] Docs updates below.

## Acceptance criteria

- [x] `run` summary output ends with a single distinct line containing the canonical `issues/new/choose` intake URL, including the zero-records render case.
- [x] `plan` summary output ends with a single distinct line containing the canonical `issues/new/choose` intake URL, including the zero-records render case.
- [x] The nudge URL is read from one shared exported code constant; both `runSummary` and `planSummary` reference that constant rather than a string literal.
- [x] The URL appears exactly once per emitted summary across all four return sites in `run-summary.ts`. As a unit-test invariant on the exported functions, the no-telemetry render also carries the nudge — this is a property of the pure functions, not an operator-reachable CLI path (both call sites gate on writes, so the no-telemetry summary is not emitted to the operator via the CLI).
- [x] `help` output contains no intake URL.
- [x] `prompt`-mode completion emits no intake nudge — verified by the absence of any nudge on every prompt exit path (prompt has no summary surface).
- [x] The constant's value equals the URL hardcoded in README.md, AGENTS.md, CLAUDE.md, and `v1/docs/operator-runbook.md`, verified by the equality check (or manual-review item) named in the task checklist.

## Documentation updates

- `v2/docs/v1-behaviors.md`: update the run-summary and plan-summary behavior entries to record that each summary now ends with a one-line intake-URL nudge sourced from a shared constant, on every emission site.
- `v1/docs/run-loop.md` and `v1/docs/plan-mode.md`: note the intake nudge line on the respective end-of-run summaries where summary output is described.
