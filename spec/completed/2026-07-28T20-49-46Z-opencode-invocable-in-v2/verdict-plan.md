# Verdict

The spec is a well-scoped, single-seam wiring change. Sizing is correct; no split needed. The following refinements are required before the draft is sound.

## Required refinements

1. **Pin how the opencode `SpawnConfig` satisfies its `name` type without widening the agent union.**
   The spawn-config `name` field is typed to a closed union of `claude | codex | cursor`, and a decision explicitly rules out widening it. The spec is silent on what value the opencode branch supplies for that field. An implementer who sets an honest `opencode` value hits a `typecheck` failure and cannot tell whether the intended fix is a placeholder value or the widening the decision forbade — stranding the "typecheck passes" acceptance criterion. Add a one-line decision-ledger entry stating how the opencode branch satisfies the `name` type without widening (or, if widening is in fact necessary, say so and drop the "rules out widening" clause). Rationale: a load-bearing choice a competent implementer could plausibly resolve wrongly, with an observable `typecheck` consequence.

2. **Record the accepted classifier regression, both as a decision and as a v1-parity entry.**
   Reusing the `cursor` classifier means opencode-specific quota strings and opencode server-side HTTP 500s — which v1 handles specially (v1 rides opencode 500s on the transient-retry loop; the shared transient set guards 502/503/504/529 but not 500) — settle in v2 as terminal `error` rather than `quota`/transient-retry. The decision currently names the exclusion but not this observable consequence.
   - Add a clause to the classifier decision naming the accepted regression (opencode-specific quota/500 handling not carried over; such cases settle generic `error`).
   - Add a `v1-behaviors.md` `[v2 difference]` entry recording this divergence, and **strike the spec's current "No `v1-behaviors.md` update: v1's opencode invocation behavior is unchanged" justification.** That justification is true but answers the wrong question: `v1-behaviors.md` is the v1↔v2 parity baseline, and it already carries `[v2 difference]` entries precisely to record where v2 diverges. A silent behavioral gap here is exactly what that catalog exists to prevent from rotting. Per spec guidance, a spec whose behavior diverges from the v1 baseline must update that catalog.

3. **Pin three one-clause parser/settlement details that the "mirrors v1" framing currently glosses:**
   - **Explicit `cost_usd: null`:** The no-`step_finish` path mandates `cost_usd: null`, but v1's equivalent case leaves `cost_usd` implicitly undefined. State that v2 sets `cost_usd: null` explicitly (a deliberate divergence from v1) so the parser→`InvocationOk` mapping is unambiguous, rather than describing it as a straight v1 mirror.
   - **Deliberate parser field names:** The new parser's output names (`cost_usd`, `displayText`) diverge from v1's (`costUsd`, `renderedText`); `displayText` aligns with the sibling cursor parser, not v1. This is acceptable for a new file, but the "mirrors v1" language implies a copy the rename silently breaks. State the naming is a deliberate choice to align with shared/`InvocationOk` conventions, so the implementer is not guessing.
   - **Clean-step-only cost coupling:** The parser task must state that cost is summed **only** from clean `step_finish` frames (matching v1, which reads `part.cost` inside the clean-token branch). The acceptance criterion says "summed cost" without this coupling; a careless implementer could sum all cost fields. Add the coupling to the parser task.

## Explicitly out of scope (no refinement required)

- **Idle-timer / frame-cadence assumption:** The spawn shape (identical stdio and `--format json` argv) is inherited unchanged from a proven-in-v1 opencode invocation; stream cadence is a v1-observed property this spec neither invents nor alters. Absence of a cadence note is not a defect.
- **Parameterized `buildArgv` shape:** Reached by default from the cursor copy target the decision already names; no decision entry earned.
- **AC-4 plural "test(s)":** Correct and sufficient — routing opencode back to the unwired branch fails both new ok-result tests.
- **Stale adjacent cursor doc line in `shared-invocation.md`:** Pre-existing drift, not this spec's seam.

Refinements 1 and 2 are load-bearing; refinement 3 is ledger hygiene. All are one-line or single-entry additions — no structural change to the spec.