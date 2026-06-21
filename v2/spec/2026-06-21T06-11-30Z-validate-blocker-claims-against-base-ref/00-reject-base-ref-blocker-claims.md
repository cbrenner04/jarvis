# 00 — Reject base-ref-failure blocker claims when base validates green

## Problem

`runIteration` detects a `## Blocker` added during an iteration, commits it, and
returns exit 7 (`v1/src/modes/patch/iteration.ts:758-802`). When the blocker
body claims the cited failures are pre-existing / unrelated / baseline, that
claim must be checked against the base ref before the run halts — observed cases
were all false and halted the run on the agent's own churn.

This subspec adds the classification + reject decision and wires it into the
exit-7 path. The actual base-ref test run is injected behind a seam here; its
production implementation lands in `01`.

## Decisions

- Validation runs **before** the blocker is committed (`commitWipProgressWithBlocker`) — a rejected blocker must leave no blocker commit. Rules out: committing then reverting.
- Claim match is a case-insensitive scan of the blocker body for pre-existing-failure language (e.g. `pre-existing`, `preexisting`, `unrelated`, `baseline`, `already fail`, `not caused by`, `not related to my change`). A non-match preserves today's exit 7 unchanged. Rules out: validating every blocker (most blockers are real and base-ref-irrelevant).
- Matcher errs toward matching: a false match only triggers a safe base-ref run that rejects solely on green. Rules out: a narrow matcher that lets the observed false claims through.
- Base-ref test run is injected via an **async** seam (`opts.runBaseRefTests?: (baseRef: string) => Promise<boolean>`, true = green). Async from the start so `01`'s real implementation (ref resolution + worktree + test command, all awaited) drops in without rewriting this contract. Default when absent = **fail-safe: blocker stands, exit 7**. Rules out: a sync `=> boolean` seam that `01` would have to break to host real async work; and making exit-7 depend on an unimplemented runner — merging this subspec alone never weakens a real blocker.
- Reject = base-ref run green (cited failures do not reproduce). On reject: strip the `## Blocker` section from the subspec file, emit a rejection telemetry event, log to stderr, and continue the iteration loop. Rules out: leaving the `## Blocker` in place (next iteration re-trips it).
- Stripping reuses the spec parser's `## Blocker` section-boundary detection (`shared/spec-parser.ts` `extractBlockerBody` index + boundary logic — export a strip helper if needed), not ad-hoc text deletion. Must honor the exact `## Blocker` heading and section end (next `## ` heading or EOF), including when the section is last or carries trailing content. Rules out: regex/substring deletion that mangles a last-section or trailing-content blocker.
- Repeated rejections are **bounded**: track consecutive claim-blocker rejections for the active subspec (mirroring `state.consecutiveEditedUnticked` / `EDITED_UNTICKED_BOUND` in `iteration.ts`); once the bound is hit the next matching claim blocker stands (exit 7) instead of re-validating. Rules out: an unbounded re-trip → re-raise → re-validate loop re-running the full base-ref suite each cycle on slow repos.
- Base-ref run red → blocker stands → exit 7 as today (conservative: any base failure lets the blocker stand). Rules out: per-test matching of cited failures — snapshot churn makes extraction brittle and the failure mode is "base was green."
- Any validation failure (seam throws, base ref unresolved, git disabled) → fail-safe blocker stands, exit 7. Rules out: validation infra errors swallowing a real blocker.
- Telemetry: a rejected claim blocker emits a distinct event (e.g. `kind: "blocker-rejected"`, `exitReason: "base-ref-green"`) and does **not** emit the existing `blocked` / `blocker-detected` event. Rules out: silence (operator can't confirm the feature fired or diagnose the rejection bound); reusing the `blocked` event (conflates reject with halt).

## Task checklist

- [ ] Add a blocker-claim classifier over the blocker body in the patch module.
- [ ] In `runIteration`, before committing the blocker, run validation when the body matches, git is enabled, and the per-subspec rejection bound is not yet hit.
- [ ] On green base-ref result: strip the `## Blocker` section via the parser's section-boundary logic, emit the `blocker-rejected` telemetry event, log rejection, increment the rejection counter, continue the loop (no exit 7, no blocker commit).
- [ ] On red / non-match / validation failure / git disabled / bound hit: keep current commit + exit 7 path (existing `blocked` event).
- [ ] Inject the base-ref run via an async test seam; default to fail-safe (stand) when absent.
- [ ] Add tests under `v1/test/run.test.ts` alongside the existing exit-7 blocker test, including the rejection bound (repeated rejections eventually stand).

## Acceptance criteria

- [ ] A blocker body citing pre-existing/unrelated/baseline failures triggers base-ref validation before exit 7; an async validation seam resolving green rejects the blocker — the run continues, no exit 7, no blocker commit, and the `## Blocker` section is removed from the subspec.
- [ ] A rejected claim blocker emits the distinct rejection telemetry event and does not emit the `blocked` / `blocker-detected` event.
- [ ] Stripping removes exactly the `## Blocker` section (heading through next `## ` heading or EOF), leaving surrounding sections intact, including when `## Blocker` is the last section and when it carries trailing content.
- [ ] After the per-subspec rejection bound is reached, a further matching claim blocker on that subspec stands (exit 7) instead of re-validating.
- [ ] The same blocker body with the validation seam resolving red lets the blocker stand: the run exits 7 and commits the blocker, as today.
- [ ] A blocker body with no pre-existing/unrelated/baseline language is not validated and exits 7 unchanged.
- [ ] With no validation seam (or when it rejects/throws, or base ref is unresolvable, or git is disabled), the blocker stands and the run exits 7 (fail-safe).
- [ ] The existing exit-7 blocker test in `v1/test/run.test.ts` stays green for non-claim blockers (behavior unchanged outside claim bodies).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — record that a patch-mode blocker citing pre-existing/unrelated/baseline failures is validated against the base ref before exit 7: base green rejects the blocker (run continues, `## Blocker` stripped, no blocker commit, distinct rejection telemetry event), base red / non-claim / validation failure / per-subspec rejection-bound-hit exits 7 as before.
