# 02 - Add Shared Usage Summaries to Plan Mode

## Problem

`jarvis run` prints token and cost summary output, but `jarvis plan` does not. Plan mode uses the same underlying agents, can consume substantial quota during interview, draft, and review phases, and should expose the same usage visibility.

The implementation should not copy patch-mode summary logic into plan mode. The user-visible output differs by mode, but telemetry capture, aggregation, source semantics, and formatting should share one path.

## Decisions

- Add plan-mode usage summaries after the final plan output for successful, blocker, quota-exhausted, and agent-error exits once at least one agent invocation occurred.
- Do not print a summary for plan preflight/configuration failures that happen before any agent invocation.
- Use the same telemetry record shape and aggregation helper as patch mode. Add fields rather than creating a parallel plan-only telemetry format.
- Add a mode discriminator, such as `mode: "patch" | "plan"`, or an equivalent record role that lets patch summaries ignore plan records and plan summaries ignore patch records even when they share a namespace and telemetry file.
- Include plan phase information in telemetry, such as `interview`, `name-only`, `draft`, or `review`, so plan summaries can explain where usage came from.
- Plan mode has agent attempts rather than patch-mode task iterations. The plan summary should label counts as `attempts` or `phase attempts`, not implementation iterations.
- Plan mode quota fallback should be represented the same way as patch mode after subspec 01: quota-only attempts are notes, not normal usage rows.
- Plan mode should use the same cost enrichment path as patch mode: if an agent result includes usage but no cost, compute cost from the configured plan-mode model id when the price table has a matching entry.
- Extract shared summary-building code so both modes can call it with mode-specific metadata:
  - shared record filtering and aggregation
  - shared cost-source and null-cost notes
  - mode-specific header fields (`spec`, `exit reason`, `duration`, `iterations` for run; `spec`, `exit reason`, `duration`, `phase attempts` for plan)
- Keep the existing plan completion next-step output intact except for appending the summary block.
- Preserve plan-mode PR lifecycle and commit behavior. This subspec is observability only.
- Preserve existing patch-mode output except for the accounting and wording changes from subspec 01.

## Tasks

- [ ] Refactor `src/run-summary.ts` into shared aggregation/formatting helpers that can render both patch and plan summaries without duplicating cost-source logic.
- [ ] Extract shared result-to-telemetry enrichment from patch mode so patch and plan both apply the same usage, cost, warning, configured model, and configured label semantics.
- [ ] Add plan-mode telemetry writes around every agent invocation in interview, name-only, draft, and review phases, including failed attempts that participate in fallback.
- [ ] Persist mode, agent warnings, usage, cost, agent label/model, phase, attempt number, and result kind for plan invocations.
- [ ] Add a plan summary renderer that uses the shared aggregation helper and labels counts as attempts or phase attempts.
- [ ] Wire `src/commands/plan.ts` and the phase helpers under `src/modes/plan/` so finalization paths print the plan summary exactly once when at least one plan agent invocation wrote telemetry.
- [ ] Ensure plan quota fallback uses the same excluded-attempt note behavior as patch mode.
- [ ] Ensure plan hard-error fallback behavior is represented accurately: failed error attempts without usage are notes, while later successful fallback attempts are counted as attempts with usage when available.
- [ ] Ensure patch-mode summaries filter out plan-mode telemetry records and plan-mode summaries filter out patch-mode telemetry records.
- [ ] Add unit tests for the shared summary aggregator that cover both patch-mode and plan-mode labels, mode filtering, warning notes, null-cost notes, and excluded quota attempts.
- [ ] Add plan-mode integration tests with stubbed agents that verify summaries are printed for success, blocker, all-agents quota, hard-error fallback, and terminal agent error, and omitted for pre-agent failures.

## Acceptance criteria

- [ ] Successful `jarvis plan` output includes a token/cost summary sourced from telemetry.
- [ ] Plan-mode blocker or all-agents-quota exits include a summary when at least one agent invocation occurred.
- [ ] Plan-mode preflight/configuration failures before any agent invocation do not print a summary.
- [ ] Plan summaries label counts as attempts or phase attempts, not implementation iterations.
- [ ] Plan summaries compute model-based cost for usage-only agent results using `modes.plan.agentOrder` model ids.
- [ ] Patch-mode `jarvis run` summaries still render with implementation iteration language.
- [ ] Patch-mode `jarvis run` summaries do not include plan-mode telemetry records from the same telemetry file.
- [ ] Plan-mode summaries do not include patch-mode telemetry records from the same telemetry file.
- [ ] Patch and plan summaries share aggregation logic for usage totals, cost totals, cost-source notes, null-cost notes, warnings, and excluded quota attempts.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/plan-mode.md` with a concise section describing plan-mode usage summaries, which phases they cover, and why counts are labelled as attempts.
- Cross-link `docs/run-loop.md` and `docs/plan-mode.md` to the shared cost-summary terminology where appropriate.
