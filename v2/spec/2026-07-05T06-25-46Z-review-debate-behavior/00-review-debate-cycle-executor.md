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
- [ ] Adversary, advocate, and adjudicator invocations are read-only: no
      write-target mutation from their bindings.
- [ ] Adjudicator's settled output is written to `verdictPath`, overwriting
      any prior content.
- [ ] Empty (or whitespace-only) verdict skips the actuator invocation for
      that cycle.
- [ ] Non-empty verdict invokes the actuator with the verdict text as its
      task input.
- [ ] Cycle loop stops after `maxCycles` cycles or the first cycle whose
      verdict is empty, whichever comes first.
- [ ] Each role invocation (adversary, advocate, adjudicator, actuator)
      threads an `invocationTelemetry` context through to
      `executeWithQuotaFallback` so `invocation_completed` rows emit per
      `telemetry-capture.md` (same envelope as write-step rows; `role` set to
      the debate role name).

## Acceptance criteria

- [ ] `v2/src/execution/review-debate.test.ts` covers: full debate order per
      cycle, verdict file overwritten each cycle, empty verdict skips the
      actuator, non-empty verdict invokes the actuator, and cycle loop stops
      at `maxCycles`.
- [ ] `executeReviewDebate` emits one `invocation_completed`-shaped telemetry
      record per role invocation (including quota-fallback rungs) when a
      telemetry context is supplied, verified against a fixture sink.

## Documentation updates

None — `v2/docs/v2-architecture.md` and `v2/docs/role-resolution.md` already
describe this shape; `telemetry-capture.md` already documents the shared
`invocation_completed` seam as behavior-agnostic.
