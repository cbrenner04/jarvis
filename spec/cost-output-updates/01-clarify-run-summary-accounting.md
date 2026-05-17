# 01 - Clarify Run Summary Accounting

## Problem

The current run summary can make quota fallback and missing-cost records look like normal work:

- A quota-exhausted Claude attempt can appear as `claude (1 iters)` even though no Claude iteration completed.
- An unavailable or no-usage record can make an agent appear to "mix cost sources" with real agent-provided cost, even when the selected model is known.
- The summary's `iterations` header can disagree with per-agent row counts because it is counting completed loop iterations while rows count telemetry records.

This makes the output harder to trust, especially when a fallback agent completes the work after an earlier agent hits quota.

## Decisions

- Use precise labels:
  - `iterations` means completed Jarvis loop iterations.
  - `attempts` means agent CLI invocations, including quota attempts.
- The cost table should aggregate chargeable usage records, not quota failures with no usage.
- Quota, model-config, timeout, blocked, and error telemetry records stay in telemetry, but the summary renders them as notes unless they include usage data.
- Per-agent table row suffixes should say `(<n> iteration(s))` only for records that represent completed loop iterations. If a future table needs to include non-iteration attempts, label them as attempts.
- Do not report "mixes cost sources" for a combination of real cost sources and `no-usage` or `unavailable` records. Missing usage/cost belongs in explicit notes.
- Only report mixed cost sources when the same agent has multiple known cost-source strategies for records with usage, such as `agent` and `computed`.
- Make the summary model-aware where possible:
  - Rows should identify the configured agent label or model when telemetry has it.
  - If an agent supplies usage but no cost and the harness can compute cost for the configured model, report `computed` rather than `unavailable`.
  - If no price exists for the configured model, report `no-price` with the existing note.
- Preserve existing total-cost behavior: sum known costs, exclude null costs, and add a note for excluded null-cost records.

## Tasks

- [ ] Extend telemetry records, if needed, to distinguish completed loop iterations from fallback attempts without losing existing `kind` values.
- [ ] Update `src/run-summary.ts` aggregation so quota-only records do not create normal cost-table iteration rows.
- [ ] Add summary notes for quota attempts, grouped by agent, such as `<n> quota attempt(s) under <agent> were excluded from usage totals.`
- [ ] Change mixed-cost-source notes to consider only records with usage and a meaningful cost source (`agent`, `computed`, or `no-price`).
- [ ] Include the configured agent label or model in telemetry and summary output where that data is already available from the agent order.
- [ ] Update `src/modes/patch/run.ts` telemetry writes so successful fallback behavior produces one completed iteration for the agent that actually ran successfully.
- [ ] Add focused tests for quota fallback followed by success, real cost plus unavailable usage, computed fallback cost, no-price records, and null-cost total notes.
- [ ] Update any snapshots or integration tests that assert the old row labels or mixed-source wording.

## Acceptance criteria

- [ ] A run where Claude hits quota and Codex completes the only task shows one completed iteration in the header and does not render a normal `claude (1 iters)` cost row.
- [ ] The same run includes a note explaining that the Claude quota attempt was excluded from usage totals.
- [ ] A Claude run with one real cost record and one unavailable/no-usage record does not print `claude mixes cost sources: agent, unavailable`.
- [ ] Mixed-source notes still appear when an agent has multiple meaningful cost sources for records with usage.
- [ ] The total row includes only known costs and keeps a note for null costs excluded from the total.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/run-loop.md`'s end-of-run summary section to define iterations, attempts, excluded quota attempts, source labels, and null-cost notes.
- Update any cost-tracking documentation to describe when cost is agent-provided, computed from the configured model, missing because of no price, or unavailable because no usage was safely captured.
