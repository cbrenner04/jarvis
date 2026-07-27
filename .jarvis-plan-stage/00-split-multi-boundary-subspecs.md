# Split multi-boundary drafted subspecs on emit

When the plan draft agent leaves one `NN-*.md` whose acceptance criteria collectively reference more
than one module boundary, the plan step must emit one subspec per boundary instead of publishing the
oversized draft whole.

## Decisions

- Multi-boundary detection uses only `## Acceptance criteria` checkbox text per drafted subspec — rules out splitting on `## Decisions` or task-checklist breadth when every AC stays single-boundary.
- Module boundary vocabulary matches intent-split surfaces (persistence, daemon request handling, CLI admission, execution loop, and comparable seams) — rules out a plan-only boundary taxonomy or file-count heuristics.
- A drafted subspec whose AC union spans k boundaries is normalized to k emitted subspecs, each with ACs for a single boundary — rules out capping at two children or leaving a remainder bundled.
- Normalization rewrites staged `NN-*.md` files and `index.md` before draft validation / plan completion publish — rules out prompt-only guidance with no staged-file enforcement.
- The same normalization runs on v1 `validateDraftOutput` / draft-commit paths and v2 plan write staging — rules out v2-only behavior.
- Emitted subspec bodies and filenames carry no split provenance (`split from`, parent slug references) and no planning-label residue — rules out lineage sections or phase/milestone identifiers in durable text.
- Deferred to first consumer: AC-to-child assignment when one criterion names multiple boundaries — pin when `plan-split-preserves-draft-scope` lands.
- Deferred to first consumer: sibling order among split children in `index.md` beyond contiguous renumbering — pin when `plan-split-index-orders-by-dependency` lands.

## Tasks

- Add boundary classification for acceptance-criterion text using the intent-split surface vocabulary.
- Add a plan-draft normalization pass that splits multi-boundary staged subspecs, renumbers `00`–`NN-*.md`, and updates `index.md` checklist links.
- Wire the pass into v1 draft validation/commit and v2 plan write staging ahead of existing shape validation.
- Extend the plan draft prompt so agents are told not to rely on unsplit multi-boundary subspecs (enforcement remains harness-side).
- Add a committed fixture staging tree with one subspec whose ACs span persistence and CLI; stub agent output to that fixture in a plan-step regression test.
- Add a guard-inversion test for the multi-boundary detector.

## Acceptance criteria

- [ ] `v1/test/modes/plan/boundary-split.test.ts` (or an adjacent plan-draft test module) drives plan-draft normalization with the multi-boundary fixture and asserts two emitted `NN-*.md` subspecs whose acceptance criteria each reference only one surface (persistence vs CLI); the test fails against the pre-change emit-as-drafted path.
- [ ] The same test asserts no emitted subspec body or `index.md` line contains split provenance phrases (`split from`, `split-from`) or planning-label tokens drawn from the fixture parent title.
- [ ] Inverting the multi-boundary detection guard turns the multi-boundary fixture test RED.
- [ ] `bun run typecheck` passes.

## Documentation updates

- None in this subspec — operator and spec-author wording lands in [02](./02-documentation.md).
