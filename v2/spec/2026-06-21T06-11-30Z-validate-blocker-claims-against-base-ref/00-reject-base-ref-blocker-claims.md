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
- Base-ref test run is injected via a seam (e.g. `opts.runBaseRefTests?: (baseRef) => boolean`, true = green). Default when absent = **fail-safe: blocker stands, exit 7**. Rules out: making exit-7 depend on an unimplemented runner — merging this subspec alone never weakens a real blocker.
- Reject = base-ref run green (cited failures do not reproduce). On reject: strip the `## Blocker` section from the subspec file, log the rejection (base ref green) to stderr, and continue the iteration loop. Rules out: leaving the `## Blocker` in place (next iteration re-trips it).
- Base-ref run red → blocker stands → exit 7 as today (conservative: any base failure lets the blocker stand). Rules out: per-test matching of cited failures — snapshot churn makes extraction brittle and the failure mode is "base was green."
- Any validation failure (seam throws, base ref unresolved, git disabled) → fail-safe blocker stands, exit 7. Rules out: validation infra errors swallowing a real blocker.

## Task checklist

- [ ] Add a blocker-claim classifier over the blocker body in the patch module.
- [ ] In `runIteration`, before committing the blocker, run validation when the body matches and git is enabled.
- [ ] On green base-ref result: strip the `## Blocker` section, log rejection, continue the loop (no exit 7, no blocker commit).
- [ ] On red / non-match / validation failure / git disabled: keep current commit + exit 7 path.
- [ ] Inject the base-ref run via a test seam; default to fail-safe (stand) when absent.
- [ ] Add tests under `v1/test/run.test.ts` alongside the existing exit-7 blocker test.

## Acceptance criteria

- [ ] A blocker body citing pre-existing/unrelated/baseline failures triggers base-ref validation before exit 7; a validation seam returning green rejects the blocker — the run continues, no exit 7, and the `## Blocker` section is removed from the subspec.
- [ ] The same blocker body with the validation seam returning red lets the blocker stand: the run exits 7 and commits the blocker, as today.
- [ ] A blocker body with no pre-existing/unrelated/baseline language is not validated and exits 7 unchanged.
- [ ] With no validation seam (or when it throws, or base ref is unresolvable, or git is disabled), the blocker stands and the run exits 7 (fail-safe).
- [ ] The existing exit-7 blocker test in `v1/test/run.test.ts` stays green for non-claim blockers (behavior unchanged outside claim bodies).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — record that a patch-mode blocker citing pre-existing/unrelated/baseline failures is validated against the base ref before exit 7: base green rejects the blocker (run continues, `## Blocker` stripped, no blocker commit), base red / non-claim / validation failure exits 7 as before.
