# Order split children by draft dependency

When `normalizePlanDraftSpecDir` splits a multi-boundary drafted subspec, emit sibling children and
rewrite `index.md` in dependency order declared in the oversized draft — not an order that inverts a
stated implement-before edge.

## Decisions

- Sibling order is computed inside `normalizePlanDraftSpecDir` in `shared/module-boundary-surfaces.ts`
  — rules out prompt-only or index-hand-edit enforcement.
- Draft ordering signals are cross-boundary edges already in the oversized parent subspec: explicit
  surface sequencing in `## Decisions` or `## Tasks` (`before`, `lands before`, `implement before`,
  numbered surface lists), and `## Prerequisites` bullets naming an earlier-surface behavior required
  before a later surface's work — rules out inferring order from acceptance-criterion checkbox order
  alone and rules out ignoring declared implement-before edges.
- When draft signals conflict with `MODULE_BOUNDARY_SURFACES` array order, draft signals win —
  rules out canonical surface-list order as the sole oracle.
- `index.md` checklist link order matches emitted `NN-*.md` sibling order — rules out renumbering
  files without aligning index links.
- Committed fixture manifest is ground truth for expected child file order and index link order —
  rules out re-invoking the classifier as the test oracle.
- Deferred to first consumer: tie-break among split siblings with no declared cross-boundary edge —
  pin when a fixture requires it.
- Deferred to `plan-split-preserves-draft-scope`: verbatim distribution of non-AC draft sections —
  this subspec only reorders split siblings; it does not change scope partitioning.

## Tasks

- Add a committed staged fixture whose oversized draft declares CLI-before-persistence (or
  equivalent inverted canonical order) via an explicit draft signal; extend
  `shared/fixtures/module-boundary-surfaces/manifest.json` with expected child file order and index
  link order.
- Teach `normalizePlanDraftSpecDir` to derive sibling order from draft signals and emit/renumber
  children accordingly.
- Extend `shared/module-boundary-surfaces.test.ts` to assert emitted file order and `index.md`
  link order match the manifest for the new fixture.
- Document index-ordered split emission in `v2/docs/workflow-runner.md` and record the ordering
  contract in `v2/docs/v1-behaviors.md` draft-validation prose.

## Acceptance criteria

- [ ] `shared/module-boundary-surfaces.test.ts` runs `normalizePlanDraftSpecDir` on the
      dependency-order fixture and asserts emitted `NN-*.md` file order and `index.md` checklist
      link order match the committed manifest; it fails against the pre-change path that orders split
      children by `MODULE_BOUNDARY_SURFACES` array order when the draft declares the opposite.
- [ ] Inverting the dependency-order enforcement guard inside `normalizePlanDraftSpecDir` turns the
      dependency-order fixture test RED.
- [ ] `v2/docs/workflow-runner.md` states that emitted split subspecs are listed in dependency
      order for implement consumption and that `index.md` link order matches that sequence.
- [ ] `v2/docs/v1-behaviors.md` draft-validation boundary-split bullet records that split siblings
      are emitted in draft-declared dependency order, not an order that inverts stated
      implement-before edges.

## Documentation updates

- `v2/docs/workflow-runner.md` — split subspecs are index-ordered for implement consumption.
- `v2/docs/v1-behaviors.md` — boundary-split normalization emits siblings in draft-declared
  dependency order.
