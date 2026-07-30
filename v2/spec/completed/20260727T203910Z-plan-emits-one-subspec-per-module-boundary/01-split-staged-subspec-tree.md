# Split staged plan-draft subspec tree

When a staged `NN-*.md` subspec's acceptance criteria span more than one module boundary, rewrite the
staged spec directory to one emitted subspec per boundary before validation or publish.

## Decisions

- `normalizePlanDraftSpecDir(specDir)` in shared code mutates staged `NN-*.md` files and `index.md`
  in place using the classifier from [00](./00-module-boundary-classifier.md) — rules out
  prompt-only enforcement.
- A drafted subspec whose AC union spans k boundaries becomes k emitted subspecs, each with ACs for
  a single boundary — rules out leaving a remainder bundled.
- Normalization runs only on plan-draft pipeline staged output (agent write step / draft commit
  worktree) immediately before validation/publish — rules out re-splitting operator hand-edits on an
  already-open plan PR outside that pipeline.
- Emitted subspec bodies, basenames, and `index.md` link text carry no split provenance (`split from`,
  `split-from`, parent slug references) and no planning-label residue — rules out lineage sections or
  phase/milestone identifiers in durable text.
- Deferred to `plan-split-preserves-draft-scope`: verbatim distribution of decisions, documentation
  bullets, and multi-surface single AC lines beyond hard-error/assign floor from [00](./00-module-boundary-classifier.md).
- Deferred to `plan-split-index-orders-by-dependency`: sibling order among split children beyond
  contiguous renumbering.

## Tasks

- Implement `normalizePlanDraftSpecDir` split/renumber/`index.md` rewrite atop the shared classifier.
- Add committed staged-tree fixtures (k=2 persistence+CLI, k=3 persistence+daemon+CLI) plus a
  ground-truth manifest of expected child AC checkbox text per fixture.
- Add `shared/module-boundary-surfaces.test.ts` driving the normalizer directly.

## Acceptance criteria

- [x] `shared/module-boundary-surfaces.test.ts` runs `normalizePlanDraftSpecDir` on the
      k=2 and k=3 fixtures and asserts emitted `NN-*.md` files match the committed ground-truth child
      AC checkbox text literally (no re-invocation of the classifier as the oracle); it fails against
      the pre-change emit-as-drafted path.
- [x] The same test asserts no emitted body, filename, or `index.md` checklist link contains forbidden
      provenance phrases, the parent fixture slug, or planning-label residue defined in the fixture
      manifest.
- [x] The same test asserts an AC line naming two known surfaces is either assigned verbatim to a child
      or causes normalization to hard-error; it fails if the line disappears.
- [x] Inverting the split-emission guard inside `normalizePlanDraftSpecDir` turns the k=2 fixture case
      RED.

## Documentation updates

- None — [05](./05-documentation.md) records the operator contract.
