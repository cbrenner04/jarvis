# Order split children by draft dependency

When `normalizePlanDraftSpecDir` splits a multi-boundary drafted subspec, emit sibling children and
rewrite `index.md` in dependency order declared in the oversized draft — not an order that inverts a
stated implement-before edge.

## Decisions

- Sibling order is computed inside `normalizePlanDraftSpecDir` in `shared/module-boundary-surfaces.ts`
  — rules out prompt-only or index-hand-edit enforcement.
- Ordering-signal sections are `## Decisions`, `## Tasks`, and `## Prerequisites` only — other
  sections (e.g. `## Problem`) do not supply edges; rules out prose outside those headings as order
  input.
- Draft ordering signals are cross-boundary edges in those sections: explicit surface sequencing
  (`before`, `lands before`, `implement before`, numbered surface lists) and `## Prerequisites`
  bullets naming an earlier-surface behavior required before a later surface's work — rules out
  inferring order from acceptance-criterion checkbox order alone and rules out ignoring declared
  implement-before edges.
- Ordering endpoints resolve surfaces through the same path as AC partitioning
  (`classifyModuleBoundaryText` or equivalent shared resolution) — rules out prose “CLI” in an edge
  diverging from AC assignment.
- When explicit `## Decisions` or `## Tasks` edges conflict with `## Prerequisites` edges,
  Decisions/Tasks win — finer multi-signal precedence may defer but conflicting explicit edges must
  not be ambiguous.
- Cycles or contradictory explicit edges hard-error (consistent with multi-surface AC hard-error) —
  rules out silent winner-picking.
- Partial orders use topological sort; unconstrained siblings tie-break by `MODULE_BOUNDARY_SURFACES`
  array order; explicit draft signals beat AC checkbox order when they disagree.
- When split siblings have no declared cross-boundary ordering signal, emission order stays
  `MODULE_BOUNDARY_SURFACES` array order (current k2/k3 behavior) — rules out inventing order without
  a draft signal.
- When draft-declared dependency order puts a non-canonical surface first, zero-surface acceptance
  criteria attach to the dependency-first emitted sibling (`boundaryIndex === 0` after reorder), not
  canonical `MODULE_BOUNDARY_SURFACES` order — rules out reordering siblings while leaving zero-surface
  ACs on the canonical-first child.
- When draft signals conflict with `MODULE_BOUNDARY_SURFACES` array order, draft signals win —
  rules out canonical surface-list order as the sole oracle.
- `index.md` checklist link order matches emitted `NN-*.md` sibling order — rules out renumbering
  files without aligning index links.
- `manifest.json` `expectedChildren` array order is authoritative for emitted child filenames and
  `index.md` checklist link sequence — rules out filename `readdir` sort or classifier re-invocation
  as the test oracle.
- Deferred to `plan-split-preserves-draft-scope` (lands after this tree): verbatim distribution of
  unclassified non-AC draft bullets — this tree pins dependency-first first-child semantics for
  zero-surface ACs; preservation extends non-AC distribution without reversing that assignment.

## Tasks

- Add committed staged fixture `k4` whose oversized draft declares CLI-before-persistence (or
  equivalent inverted canonical order) via an explicit draft signal and includes at least one
  zero-surface acceptance criterion; extend `shared/fixtures/module-boundary-surfaces/manifest.json`
  with `k4` `expectedChildren` array order encoding both emitted filenames and index link sequence.
- Teach `normalizePlanDraftSpecDir` to derive sibling order from draft signals, emit/renumber
  children accordingly, and assign zero-surface ACs to the dependency-first sibling.
- Extend `shared/module-boundary-surfaces.test.ts` to parse `index.md` checklist link order and
  assert it matches `expectedChildren` array order (not emitted filename sort alone); assert k4
  zero-surface AC lands on the dependency-first child.
- Add hard-error coverage or fixture for cycle/contradictory explicit edges when a committed case
  exists; otherwise document the guard in code comments at the ordering parser.
- Document index-ordered split emission in `v2/docs/workflow-runner.md` and record the ordering
  contract in `v2/docs/v1-behaviors.md` draft-validation prose.

## Acceptance criteria

- [x] `shared/module-boundary-surfaces.test.ts` runs `normalizePlanDraftSpecDir` on fixture `k4`
      and asserts emitted `NN-*.md` file order and parsed `index.md` checklist link order match
      `expectedChildren` array order in the manifest; it fails against the pre-change path that
      orders split children by `MODULE_BOUNDARY_SURFACES` array order when the draft declares the
      opposite.
- [x] Fixture `k4` asserts zero-surface acceptance criteria land on the dependency-first emitted
      sibling, not the canonical-first surface child.
- [x] Inverting the dependency-order enforcement guard inside `normalizePlanDraftSpecDir` turns the
      fixture `k4` test RED.
- [x] k2 and k3 manifest fixture tests stay green (no-signal siblings remain in
      `MODULE_BOUNDARY_SURFACES` order).
- [x] `v2/docs/workflow-runner.md` states that emitted split subspecs are listed in dependency
      order for implement consumption and that `index.md` link order matches that sequence.
- [x] `v2/docs/v1-behaviors.md` draft-validation boundary-split bullet records that split siblings
      are emitted in draft-declared dependency order, not an order that inverts stated
      implement-before edges.

## Documentation updates

- `v2/docs/workflow-runner.md` — split subspecs are index-ordered for implement consumption.
- `v2/docs/v1-behaviors.md` — boundary-split normalization emits siblings in draft-declared
  dependency order.
