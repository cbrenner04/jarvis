# Module boundary classifier

Commit the harness-owned mapping from acceptance-criterion text to module boundaries so plan split
and later intent-split work share one testable vocabulary.

## Decisions

- Canonical contract lives in `shared/module-boundary-surfaces.ts`: committed surface ids and a
  classifier over arbitrary text — rules out plan-only taxonomy, file-count heuristics, and
  prompt-only surface lists.
- Initial surface ids match intent-split seams: `persistence`, `daemon`, `cli`, `execution-loop` —
  rules out a divergent plan vocabulary; additional seams extend this module, not ad hoc plan code.
- Multi-boundary detection reads only `## Acceptance criteria` checkbox line text per drafted
  subspec — rules out splitting on `## Decisions` or task-checklist breadth when every AC stays
  single-boundary.
- Union across all AC lines in one subspec yields k boundaries; k > 1 is the split trigger — rules
  out capping at two children.
- An AC line that matches more than one known surface is never silently dropped at split time;
  assignment or hard-error is required — rules out omitting multi-match criteria until
  `plan-split-preserves-draft-scope` refines assignment.
- AC text that matches zero known surfaces contributes no extra boundary for split detection — rules
  out splitting solely on unclassified prose.

## Tasks

- Add `shared/module-boundary-surfaces.ts` with surface ids, per-text classification, and
  `spansMultipleModuleBoundaries` (or equivalent) over a subspec's AC lines.
- Add `shared/module-boundary-surfaces.test.ts` with phrase fixtures and k=3 union coverage.

## Acceptance criteria

- [x] `shared/module-boundary-surfaces.test.ts` maps committed fixture phrases to `persistence`,
      `daemon`, and `cli` and asserts a three-line AC union spans all three boundaries; it fails
      against the pre-change code.
- [x] The same module asserts a zero-match AC line paired with single-boundary classified lines does
      not by itself trigger `spansMultipleModuleBoundaries`.
- [x] Inverting the `spansMultipleModuleBoundaries` guard turns the three-boundary union test RED.

## Documentation updates

- None — [05](./05-documentation.md) cites this module for operators.
