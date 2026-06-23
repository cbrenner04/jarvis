## Verdict — Refinements Required

The run-loop logic (shift/retry/exhaust, telemetry row kind, message suppression, run-wide stickiness, shared ladder) is correct and matches the spec. Two ticked acceptance criteria, however, are not actually verified by the tests that claim to cover them. Both must be closed before these boxes can honestly stay checked.

### Required outcomes

1. **AC #1's "same subspec" promise must be pinned by a test that exercises it.** The new multi-rung test uses a flat single-task spec with no git-backed, multi-subspec index, so `activeSubspecPath` is undefined and "retried iteration targets the same subspec" is trivially true rather than verified. Add (or extend) a test that builds a real multi-subspec index and asserts the post-advance iteration re-selects the *same* unticked subspec. The behavior is correct by construction, but AC #1 explicitly promises this is shown by a test — ticking it without exercising the multi-subspec path is the paraphrase-instead-of-verify gap the spec guidance warns against.

2. **AC #2's "unless `maxIterations` is reached first" clause must be pinned by a test.** This branch is currently asserted only in docs. Add a test with a ladder longer than a low `maxIterations` so the cap pre-empts ladder exhaustion (terminal exit reflects the cap, not exit-4 from an empty `activeAgents`). The mechanism reuses already-tested quota-fallback machinery, so risk is low — but the clause is part of a checked AC and must be exercised, not asserted by inspection.

### Not required (rejected findings)

- **Iteration-count accounting on fallback rungs is correct, not inflated.** Emitting the advance on a non-terminal `kind:"ok"` row is spec-mandated (it matches the existing terminal `no-progress` and `criteria-progress` rows, which also count). Each rung is a completed agent turn; the counter measures turns taken, not criteria ticked. Using a quota-flavored row to avoid the increment would violate the spec. No change. (A regression test asserting `iterations: N` for an N-rung ladder is optional, not required.)
- **Escalation line naming the shifted-off agent** deliberately mirrors the quota-fallback message convention; diverging unilaterally is out of scope. No change.

### Optional (not blocking)

- A one-line `agents.md` note distinguishing the escalating pure-no-progress (no-edit) case from the non-escalating edited-but-unticked retry-then-exit-6 path would aid operators, but the edited-untick path is explicitly out of scope and correctly excluded. Cosmetic only.

### Rationale

Outcomes 1 and 2 are the only blocking items: both ACs are marked `[x]` but their distinguishing claims ("same subspec", "unless `maxIterations` first") are not actually exercised by the committed tests. Per the repo's ledger discipline, a checked acceptance criterion must be verified, not asserted by construction. No code-logic changes are warranted.