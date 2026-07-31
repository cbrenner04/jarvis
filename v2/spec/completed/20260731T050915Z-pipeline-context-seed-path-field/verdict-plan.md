Reviewing the spec draft and codebase to validate the advocate's positions and issue a verdict.
## Verdict — required refinements

### 1. Serial-sibling scope and prerequisites

The subspec correctly limits work to the persistence surface, but it does not tell plan-PR readers that admission routing (`--seed` / `--seed-text`) and stage consumption land in separate intents. Add a **Prerequisites** section (or equivalent Decisions cross-refs) naming the sibling intents `pipeline-start-seed-path-admission` and `pipeline-intent-stage-seed-path-identity`, with this spec as their shared prerequisite. Add an explicit Decision that **stage resolution is unchanged** until the intent-stage sibling lands.

**Rationale:** Intent describes full admission behavior; spec guidance requires serial siblings on the same seam and mergeable specs that do not mislead reviewers about what ships in this PR.

### 2. Deferred store validation — replace vague pin

Replace “pin when a caller needs durable rows validated at persistence admission” with an explicit outcome: **store-side rejection of dual-populated `seedPath`+`seed` remains unscheduled**; mutual exclusivity is enforced at admission (`pipeline-start-seed-path-admission`), not validated in the store on this slice.

**Rationale:** The current pin is not actionable; sibling intents already own xor enforcement.

### 3. Acceptance criterion 1 — name the real pre-fix failure surface

AC 1 must state that **typed** `PipelineContext` admission with `seedPath` and without `seed` **fails `bun run typecheck` pre-fix** (required `seed`, missing `seedPath` on the type). The round-trip test validates typed persistence after the type change; opaque JSON round-trip alone is not new behavior. Replace “comment checkpoint” with repo convention **`Mutation checkpoint:`**.

**Rationale:** Spec guidance requires runtime-behavior subspecs to name a failing-test surface against baseline; here the contract is the type shape, not store serialization logic.

### 4. Acceptance criterion 2 — checkpoint wording

Keep the legacy `seed`-only preservation AC; replace “comment checkpoint” with **`Mutation checkpoint:`** when describing the guard against synthesizing `seedPath` on load.

**Rationale:** Matches existing `state-store.test.ts` convention and pins the no-migrate-on-read decision.

### 5. Task checklist — typecheck blast radius

Add a task to **fix `PipelineContext` fixtures and compile sites across v2** affected by optional `seed` (e.g. `SAMPLE_PIPELINE_CONTEXT`, daemon pipeline tests, `baseContext` helpers). Add a task to **extend `PipelineContext` JSDoc** with optional fields, mutual exclusivity for new admissions, and store non-requirement of either seed field.

**Rationale:** Optional `seed` breaks compilation beyond `state-store.ts`; the typecheck AC implies this sweep but tasks should name it so implementers do not treat the slice as a single-file change.

### 6. Documentation updates — persistence boundary semantics

Expand the `state-store.md` obligation (and align JSDoc) to cover:

- `seedPath` and inline `seed` are optional; **store does not require either** on admission (existing permissiveness).
- Path strings are **admission-supplied**; **relative-base resolution is not store responsibility** — point to admission docs/sibling.
- **Dual-populated or legacy ambiguous rows load as stored**; no migrate-on-read; store validation deferred.

Optionally update the `v1-behaviors.md` additive context-field bullet to list optional `seedPath` for catalog accuracy (docs-only; not operator-behavior change).

**Rationale:** “Project-relative” appears in intent but persistence is opaque strings; docs must not imply store resolves paths. Neither-field and dual-field cases are real load shapes that belong in the persistence contract.

### 7. Intent–subspec AC alignment

Align `intent.md` acceptance criteria with the subspec: AC 1 should reference typed construction / typecheck failure and `Mutation checkpoint:` wording, not only “omitting `seedPath` on the type.”

**Rationale:** Intent is part of the draft package; stale AC wording understates the runtime contract and diverges from the sharpened subspec.

---

**Not required on this slice (upheld as out of scope):** store-side dual-populated rejection ACs; `daemon-host.md` updates; new AC for “neither seed field”; inverted-guard tests for store xor validation.