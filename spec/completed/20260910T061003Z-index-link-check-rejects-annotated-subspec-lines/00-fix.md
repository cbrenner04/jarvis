# The index link check rejects any subspec line with a trailing annotation

## Problem

`assertLinkedNumberedSubspecs` (`v2/src/execution/publication-landing.ts:53`) decides which numbered subspecs are linked by matching each index line against:

```ts
const INDEX_LINK_PATTERN = /^\s*-\s\[[ xX]\]\s+\[[^\]]+\]\((?:\.\/)?([^)]+)\)$/u;
```

The `$` is anchored immediately after the link's closing paren, so **any** trailing text on the line makes it unmatched — and an unmatched line means the subspec it links is treated as not linked at all. Publication then fails:

```text
plan: unlinked_numbered_subspec: 04-deduplicate-skipped-artifact-lines.md is not linked from index.md; rerun to retry pre-publication
```

Observed 2026-09-07 on `plan/cleanup-reclaims-terminal-worktrees`, which failed this way **three times**. The index was well-formed and the subspec *was* linked; the only difference from its five green siblings was a sequencing annotation:

```md
- [ ] [03 - Scope detached ownership to identified artifacts](./03-spec-scoped-detached-ownership.md)
- [ ] [04 - Deduplicate skipped artifact reporting](./04-deduplicate-skipped-artifact-lines.md) (after 00 and 03)
```

Three things make this expensive out of proportion to the fix:

- **The message points at the wrong thing.** It names the file and says it is not linked, so the operator opens `index.md`, sees the link present, and has no reason to suspect the trailing text. Diagnosis took reading the regex.
- **It fires at publication**, after the whole plan is drafted and reviewed — the draft is sound and the entire run is discarded for a comment.
- **It punishes useful authoring.** Recording a dependency inline (`(after 00 and 03)`) is exactly what a reader of a multi-subspec index wants; the gate silently forbids it while permitting the same information nowhere else on the line.

Structural sibling of [[plan-contract-classifies-the-rules-out-clause]]: a plan-contract check hostile to a well-formed document, where the fix is to make the check tolerant rather than to constrain the author further. Also the same *lexical over-match* family as #3383.

## Decisions

- The index link check extracts the link target from a subspec line and ignores trailing prose after the closing paren; rules out anchoring `$` at the paren and reading annotated lines as absent links.
- Leading text before the checkbox stays rejected, and a line with no parseable link stays unlinked; rules out widening the pattern into accepting arbitrary lines as links.
- When a numbered subspec genuinely is not linked, the failure names the file **and** reports that no index line links it, distinguishing "absent" from "present but unparseable"; rules out one message covering both causes.
- Scope is the link-extraction pattern and its failure text; rules out changing which files count as durable plan content.

## Acceptance criteria

- [x] A test proves an index line with trailing text after the link (for example `(after 00 and 03)`) counts the subspec as linked; it fails against the current `$`-anchored pattern.
- [x] A test proves a numbered subspec with no index line at all still fails, with a message distinguishing it from the unparseable-line case.
- [x] A test proves a line with leading text before the `- [x]` checkbox is still not treated as a link.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — state that index subspec lines may carry trailing annotations after the link.
- `v2/docs/v1-behaviors.md` — record the corrected v2 behavior.
