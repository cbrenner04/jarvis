# 00 - Review-debate cycle executor

Standalone executor for one review-debate cycle: read-only `adversary` →
`advocate` → `adjudicator` produce a verdict; a separate `actuator` (the only
writer) applies it. Runs up to a configured bound of cycles. Lives in
`v2/src/execution/review-debate.ts`, alongside `write-loop.ts`.

## Decisions

- Fixed role order per cycle: `adversary` → `advocate` → `adjudicator` →
  `actuator` — matches `role-resolution.md` and is not configurable; a
  different order is not a debate.
- Each role invocation goes through `executeWithQuotaFallback` (`shared/invocation/execute.ts`)
  against caller-supplied bindings, same as write-step invocations — rules out
  a second invocation/fallback mechanism for debate roles.
- Verdict text is caller-supplied via a `verdictPath` input, written by this
  executor after the adjudicator settles; the executor does not derive the
  path from an artifact path — rules out this slice guessing a plan-vs-implement
  naming convention no caller yet needs.
- Empty verdict (no content or whitespace-only, matching v1's
  `verdict-patch.md` semantics) skips the actuator invocation for that cycle
  and does not write a verdict-apply attempt — rules out running the actuator
  on a no-op verdict.
- Default cycle bound is 1; caller passes `maxCycles` explicitly — rules out
  a hidden convergence loop when the intent is only "N cycles, no
  materiality judgment."
- `maxCycles <= 0` executes zero cycles (no invocations, no verdict write)
  rather than being rejected — rules out treating a caller-computed bound of
  zero as an error.
- `executeWithQuotaFallback` never throws on exhaustion; it resolves with
  `final: null` (matches `step-runner.ts`'s existing handling). For each of
  the four roles, a `final: null` result aborts the current cycle
  immediately (no further roles run that cycle, actuator included) and is
  returned as a failure outcome for that cycle rather than being caught and
  silently skipped — rules out a partial-cycle verdict or actuator run built
  on a role that never produced output.
- Read-only enforcement for `adversary`/`advocate`/`adjudicator` is a
  binding-contract convention (their bindings are typed to expose no write
  capability), not a sandboxing guarantee this slice enforces at runtime —
  rules out promising unfalsifiable runtime write-prevention no test here
  can check.
- The verdict text written to `verdictPath` is the adjudicator's raw
  `executeWithQuotaFallback` stdout output, unparsed and unnormalized —
  rules out this slice inventing a verdict schema or trimming/parsing
  convention no caller has asked for.
- The caller is responsible for supplying a distinct `verdictPath` per
  concurrently-running step invocation; the executor does not dedupe or
  namespace paths — consistent with the existing decision that it doesn't
  derive paths from an artifact path.
- Deferred to first consumer: durable resumability (state-store attempt
  rows, interrupted-cycle resume) for a review-debate step — pin when the
  workflow runner wires this in (see subspec 01).
- Deferred to first consumer: whether a prior cycle's verdict text is passed
  as context into the next cycle's adversary prompt — pin when a caller
  configures `maxCycles > 1`.
- Deferred to first consumer: any artifact-contract check on the actuator's
  output (write steps have `expectedArtifactPath`; debate steps have no
  such contract in this slice) — pin when a caller needs one.

## Task checklist

- [ ] Add `v2/src/execution/review-debate.ts` exporting `executeReviewDebate`:
      takes per-role invocation bindings (`adversary`, `advocate`,
      `adjudicator`, `actuator`), prompts, `verdictPath`, and `maxCycles`;
      returns a per-cycle outcome summary (verdict text, whether the actuator
      ran, and each role's `executeWithQuotaFallback` result).
- [ ] Adversary, advocate, and adjudicator bindings are typed to carry no
      write capability (read-only-by-construction; not a runtime sandbox
      check).
- [ ] Adjudicator's settled output is written to `verdictPath` verbatim
      (raw stdout, no parsing/normalization), overwriting any prior content.
- [ ] Empty (or whitespace-only) verdict skips the actuator invocation for
      that cycle.
- [ ] Non-empty verdict invokes the actuator with the verdict text as its
      task input.
- [ ] Cycle loop stops after `maxCycles` cycles or the first cycle whose
      verdict is empty, whichever comes first; `maxCycles <= 0` runs zero
      cycles.
- [ ] A `final: null` result from any role's `executeWithQuotaFallback` call
      aborts that cycle immediately (no later roles in the same cycle run)
      and is surfaced as a per-cycle failure outcome.
- [ ] Each role invocation (adversary, advocate, adjudicator, actuator)
      threads an `invocationTelemetry` context through to
      `executeWithQuotaFallback` so `invocation_completed` rows emit per
      `telemetry-capture.md` (same envelope as write-step rows; `role` set to
      the debate role name).

## Acceptance criteria

- [x] `v2/src/execution/review-debate.test.ts` covers: full debate order per
      cycle, verdict file overwritten each cycle, empty verdict skips the
      actuator, non-empty verdict invokes the actuator, cycle loop stops at
      `maxCycles`, and `maxCycles <= 0` runs zero cycles.
- [x] `review-debate.test.ts` covers the combined case: `maxCycles > 1` where
      an early cycle's verdict is empty — the loop stops at that cycle
      (actuator skipped, later cycles never run) rather than continuing to
      `maxCycles`.
- [x] `review-debate.test.ts` covers a role invocation whose
      `executeWithQuotaFallback` call resolves `final: null`: the current
      cycle aborts without running later roles, and the aborted cycle is
      reported as a failure outcome.
- [x] `executeReviewDebate` emits `invocation_completed`-shaped telemetry: one
      row per binding subprocess in attempt order (matching the quota-fallback
      rung cardinality `telemetry-capture.md` already pins for write-step
      invocations — not one aggregate row per role) when a telemetry context
      is supplied, verified against a fixture sink.

## Documentation updates

- Add a "Review-debate cycle" section to `v2/docs/write-behavior.md`
  (documents `write-loop.ts`'s equivalent run semantics today) covering:
  default `maxCycles` of 1, empty-verdict-skips-actuator, verdict overwritten
  each cycle, and `maxCycles <= 0` running zero cycles.
