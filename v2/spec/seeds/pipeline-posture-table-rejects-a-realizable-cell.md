---
name: pipeline-posture-table-rejects-a-realizable-cell
---

# The pipeline posture table rejects `intent` + `debate`, which is realizable

## Problem

`v2/src/execution/pipeline-definition.ts` (shipped in #2240) classifies two `(workflow, review)`
cells as unrealizable and rejects them with `unrealizable-review-posture`:

```ts
(workflow === "intent" && review === "debate") || (workflow === "implement" && review === "none")
```

`implement` + `none` is correct — `ImplementReviewBehavior` is `"debate" | "light"` with no opt-out.

**`intent` + `debate` is wrong.** The plan reasoned from the legacy alias set (`intent-reviewed` has
one reviewed variant, so debate "has nothing to resolve to"), but bare `intent` takes a review
behavior directly:

```text
usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>]
       [--review-passes <n>] [--review-behavior debate|light] [--detach]
```

`--review-behavior debate` on `intent` is a supported, documented invocation
(`v2/docs/operator-runbook.md` § Workflow presets shows it). The validator therefore refuses a
composition the harness can execute today.

Nothing consumes the table yet, so this is currently inert — but it is a false constraint baked into
a validator, and the moment a pipeline stage resolves a posture it becomes an unexplainable refusal.

## Decisions

- `intent` + `debate` resolves to the bare `intent` preset with `reviewBehavior: "debate"`, exactly
  as the CLI flag does. Rules out keeping the cell unrealizable.
- The table's realizations are stated against the **bare presets and their review-behavior
  parameter**, not the legacy `*-reviewed` aliases. Rules out reasoning from an alias set the runbook
  already calls legacy — that is what produced the wrong cell.
- `implement` + `none` stays unrealizable, for the stated type-level reason. Rules out relaxing the
  cell that is genuinely unreachable.
- The table and the CLI's accepted `(workflow, review-behavior)` combinations are pinned to each
  other by a test, so a future CLI change cannot silently re-open the same gap. Rules out fixing one
  cell and leaving the two sources unlinked.

## Acceptance criteria

- [ ] An `intent` stage under `debate` validates clean and resolves to the bare `intent` preset with
      `reviewBehavior: "debate"`; the test fails against the shipped `unrealizable-review-posture`
      rejection.
- [ ] An `implement` stage under `none` still gets `unrealizable-review-posture` with its stage ID,
      the `review` field, workflow name, and posture in the message.
- [ ] A test asserts every `(workflow, posture)` cell the table calls realizable is accepted by the
      corresponding CLI surface, and every cell it calls unrealizable is not — failing if the two
      diverge.
- [ ] `v2/docs/workflow-runner.md`'s resolution table is corrected in the same change.

## Documentation updates

- `v2/docs/workflow-runner.md` — correct the `intent`/`debate` cell and restate the table against the
  bare presets plus review behavior rather than the legacy aliases.
