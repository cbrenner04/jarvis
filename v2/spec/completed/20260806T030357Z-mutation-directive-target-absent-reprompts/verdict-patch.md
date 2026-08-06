Verifying the critical classification and resume paths in the implementation before issuing the verdict.
# Verdict: required outcomes

## Blocking — correctness

**1. Do not reprompt on non-mutation `spec.criteria-ticked` failures**

The write-loop intercept keys only on `failedContractId === "spec.criteria-ticked"` and re-runs mutation verification. When the unticked-criteria contract fails first (same id, different failure mode), a concurrent repromptable mutation state can still trigger reprompt: no `contract_miss_detail`, no `## Blocker`, unticked rows never surfaced.

**Required:** Reprompt applies only when the miss is mutation-checkpoint-shaped — every blocking failure is repromptable `target_absent` / `target_ambiguous` with no hollow checkpoint and no mixed unparseable reasons — not when the step failed for unticked non-human-only criteria or other non-repromptable criteria-ticked reasons.

**Regression:** A fixture with at least one unticked criterion plus a repromptable `target_absent` directive must hard-block (terminal `contract_miss`, `appendBlockerToSpec`, no `mutation_directive_reprompt`), not reprompt.

**Rationale:** Spec scopes reprompt to pin-text mismatch when production work is otherwise complete. Masking the unticked gate violates the implement completion contract.

---

**2. Resume must deliver the full directive list to the agent**

Pause/resume replays `mutation_directive_reprompt` from the log, but the prompt path uses only truncated `display` (500-char cap) and drops structured `directives`. In-loop continuation uses the full untruncated listing.

**Required:** After resume, the next write-step prompt’s directive list is complete and equivalent to in-loop reprompt — every offending directive in `describeUnparseable` shape (`pinningFile:line: reason: raw`), even when log `display` is truncated or many directives are present.

**Rationale:** Spec requires resume replay from persisted log with structured fields sufficient for audit and repair; a degraded resume path breaks the stated lifecycle.

---

## Blocking — spec-aligned test coverage

**3. Daemon resume regression for mutation-directive reprompt**

`findMutationDirectiveRepromptFromLog` is wired through `reconstructWriteResume` (landing precedent), but there is no sibling to the `landing_contract_reprompt` case in `daemon-resume.test.ts`.

**Required:** A resume test proves a paused implement run restores `mutationDirectiveReprompt` from a `mutation_directive_reprompt` log tail and passes it into the resumed write loop.

**Rationale:** Resume is an explicit task-checklist and reprompt-lifecycle requirement; wiring without regression leaves the seam unguarded.

---

## Required — test hardening (behavior already implemented; AC gaps)

**4. Multi-directive reprompt**

Decision ledger and code list every blocking repromptable entry in one payload; no test exercises two `target_absent` / `target_ambiguous` directives in a single reprompt.

**Required:** One test asserts one `mutation_directive_reprompt` event carries every offending directive in `describeUnparseable` listing shape.

---

**5. Mixed-failure beyond `unresolved_pinning_test`**

Mixed-failure AC names hollow, `unresolved_pinning_test`, and other reasons. Existing test covers only `target_absent` + `unresolved_pinning_test`.

**Required:** At least one additional mixed case (e.g. `target_absent` + hollow checkpoint) asserts hard-block with no reprompt event. Predicate logic already excludes hollow; the AC needs explicit coverage.

---

## Required — documentation alignment

**6. `v2/docs/write-behavior.md`**

The criteria-ticked bullet documents reprompt, but the summary immediately after still says “Any fail → append `## Blocker` … (`contract_miss`)” without the reprompt carve-out. Landing reprompt has a dedicated pause/resume paragraph; mutation reprompt does not.

**Required:** Summary and recovery guidance match implemented behavior: repromptable mutation misses skip terminal settle within budget; resume replays last `mutation_directive_reprompt`; reprompt context persists across non-`complete` iterations until mutation checkpoints pass (same pattern as landing reprompt).

---

**7. `v2/docs/operator-runbook.md`**

Gate trust still points at non-existent seed `v2/spec/seeds/implement-reconciles-mutation-directive-to-landed-code`. Work landed as `20260806T030357Z-mutation-directive-target-absent-reprompts` (already noted in `implement-queue.md`).

**Required:** Replace stale seed pointer with the landed spec path or remove it. Recovery workflow (~815–817) documents only `landing_contract_reprompt`; add parallel guidance for `mutation_directive_reprompt` on paused implement runs.

---

## Not required for actuator (acknowledged, non-blocking)

- Shared `blockingUnparseableEntries` helper extraction (maintainability only).
- Double `verifyMutationCheckpoints` on intercept (accepted seam per spec).
- Multi-iteration exhaustion before hard-block (`maxIterations: 1` satisfies minimum AC).
- Full-string `describeUnparseable` assertion beyond existing structured-field checks.

---

## Summary

Ship after **1–7**. Core reprompt vs hard-block boundary is correct for the tested paths; **1** and **2** are harness correctness bugs. **3–5** close spec-required lifecycle and AC coverage gaps. **6–7** complete documentation updates the subspec already requires.